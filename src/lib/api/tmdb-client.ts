import type { TmdbMovie, TmdbMovieDetail, TmdbSearchResult } from '../../types/tmdb';
import { RateLimiter } from '../utils/rate-limiter';
import { fetchWithRetry } from '../utils/fetch-retry';
import { getTmdbIdCache, saveTmdbIdMapping } from '../storage/cache-store';
import { isStoreDistribution } from '../config/distribution';

const DIRECT_BASE_URL = 'https://api.themoviedb.org/3';
const DEFAULT_PROXY_BASE_URL = 'https://lekkerboxd-tmdb-proxy.lekkerboxd.workers.dev';

// TMDb allows 40 req/10s — we use 10/s to stay safe while increasing throughput.
const rateLimiter = new RateLimiter(10, 10);
const inFlightRequests = new Map<string, Promise<unknown>>();

export function canUseDefaultTmdbProxy(): boolean {
  return isStoreDistribution();
}

export function requiresUserTmdbKey(): boolean {
  return !canUseDefaultTmdbProxy();
}

function getEffectiveProxyBaseUrl(apiKey: string): string | null {
  // User-provided key explicitly opts into direct TMDb mode.
  if (apiKey.trim()) return null;
  return canUseDefaultTmdbProxy() ? DEFAULT_PROXY_BASE_URL : null;
}

export function isTmdbConfigured(apiKey: string): boolean {
  return Boolean(getEffectiveProxyBaseUrl(apiKey) || apiKey.trim());
}

function getRequestKey(
  path: string,
  params: Record<string, string>,
  apiKey: string,
): string {
  const proxyBaseUrl = getEffectiveProxyBaseUrl(apiKey);
  const url = proxyBaseUrl
    ? new URL(`/v1/tmdb${path}`, proxyBaseUrl)
    : new URL(`${DIRECT_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return `${proxyBaseUrl ? 'proxy' : 'direct'}:${url.toString()}:${apiKey.trim() ? 'has-key' : 'no-key'}`;
}

async function tmdbFetch<T>(
  path: string,
  apiKey: string,
  params: Record<string, string> = {},
): Promise<T> {
  await rateLimiter.acquire();

  const requestKey = getRequestKey(path, params, apiKey);
  const existing = inFlightRequests.get(requestKey) as Promise<T> | undefined;
  if (existing) return existing;

  const requestPromise = (async () => {
    const proxyBaseUrl = getEffectiveProxyBaseUrl(apiKey);

    if (proxyBaseUrl) {
      const url = new URL(`/v1/tmdb${path}`, proxyBaseUrl);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }

      const response = await fetchWithRetry(url.toString(), {
        headers: {
          // Some extension fetch contexts do not send Origin/Referer.
          // Provide explicit extension origin for proxy allowlist validation.
          'X-Lekkerboxd-Origin': `chrome-extension://${chrome.runtime.id}`,
        },
      });
      if (!response.ok) {
        let reason = `${response.status} ${response.statusText}`;
        try {
          const body = await response.json() as { error?: string };
          if (body?.error) reason = `${reason} (${body.error})`;
        } catch {
          // Ignore parse errors and keep status text.
        }
        throw new Error(`TMDb proxy error: ${reason}`);
      }
      return response.json() as Promise<T>;
    }

    const url = new URL(`${DIRECT_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    // Try Bearer token auth first (TMDb v4 Read Access Token, keeps key out of URLs).
    // Falls back to api_key query param (TMDb v3 API key) if Bearer fails.
    let response = await fetchWithRetry(url.toString(), {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (response.status === 401) {
      // Bearer auth failed — likely a v3 API key, use query param instead
      url.searchParams.set('api_key', apiKey);
      response = await fetchWithRetry(url.toString());
    }

    if (!response.ok) {
      throw new Error(`TMDb API error: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  })();

  inFlightRequests.set(requestKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inFlightRequests.delete(requestKey);
  }
}

export async function searchMovie(
  apiKey: string,
  title: string,
  year?: number | null,
): Promise<TmdbMovie | null> {
  const params: Record<string, string> = { query: title };
  if (year) params.year = String(year);

  const result = await tmdbFetch<TmdbSearchResult>('/search/movie', apiKey, params);
  if (result.results.length === 0) return null;

  // If year was specified, try exact match first
  if (year) {
    const exactMatch = result.results.find(m => {
      const releaseYear = m.release_date ? parseInt(m.release_date.split('-')[0]) : null;
      return releaseYear === year;
    });
    if (exactMatch) return exactMatch;
  }

  return result.results[0];
}

export async function getMovieWithRecommendations(
  apiKey: string,
  tmdbId: number,
): Promise<TmdbMovieDetail> {
  return tmdbFetch<TmdbMovieDetail>(
    `/movie/${tmdbId}`,
    apiKey,
    { append_to_response: 'recommendations,similar' },
  );
}

export async function resolveLetterboxdToTmdb(
  apiKey: string,
  slug: string,
  title: string,
  year: number | null,
): Promise<number | null> {
  // Check cache first
  const cache = await getTmdbIdCache();
  const cached = cache.get(slug);
  if (cached !== undefined) return cached;

  // Search TMDb
  const movie = await searchMovie(apiKey, title, year);
  if (!movie) return null;

  // Cache the mapping
  await saveTmdbIdMapping(slug, movie.id);
  return movie.id;
}

export async function batchResolveTmdbIds(
  apiKey: string,
  films: { slug: string; title: string; year: number | null }[],
): Promise<Map<string, number>> {
  const cache = await getTmdbIdCache();
  const resolved = new Map<string, number>();
  const toResolve: typeof films = [];

  // Use cached IDs where available
  for (const film of films) {
    const cached = cache.get(film.slug);
    if (cached !== undefined) {
      resolved.set(film.slug, cached);
    } else {
      toResolve.push(film);
    }
  }

  if (toResolve.length === 0) return resolved;

  // Resolve uncached films concurrently; tmdbFetch rate limiting controls throughput.
  const results = await Promise.allSettled(
    toResolve.map(film => resolveLetterboxdToTmdb(apiKey, film.slug, film.title, film.year)),
  );
  results.forEach((result, idx) => {
    if (result.status === 'fulfilled' && result.value !== null) {
      resolved.set(toResolve[idx].slug, result.value);
    }
  });

  return resolved;
}
