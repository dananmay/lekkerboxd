interface Env {
  TMDB_API_KEY: string;
  ALLOWED_ORIGIN?: string;
  CACHE_TTL_SEARCH_SECONDS?: string;
  CACHE_TTL_MOVIE_SECONDS?: string;
}

const TMDB_BASE = 'https://api.themoviedb.org/3';
const inFlightRequests = new Map<string, Promise<Response>>();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const originCheck = validateOrigin(request, env);
    if (originCheck) return originCheck;

    if (request.method === 'OPTIONS') {
      return handleOptions(request, env);
    }
    if (request.method !== 'GET') {
      return jsonError('Method not allowed', 405, request, env);
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1/tmdb/')) {
      return jsonError('Not found', 404, request, env);
    }

    const tmdbPath = url.pathname.replace('/v1/tmdb', '');
    if (!isAllowedPath(tmdbPath)) {
      return jsonError('Path not allowed', 403, request, env);
    }

    const tmdbUrl = buildTmdbUrl(tmdbPath, url.searchParams);
    const cacheKey = new Request(tmdbUrl.toString(), { method: 'GET' });
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      return withCors(cached, request, env, true);
    }

    const requestKey = tmdbUrl.toString();
    const pending = inFlightRequests.get(requestKey);
    if (pending) {
      const shared = await pending;
      return withCors(shared.clone(), request, env, false);
    }

    const upstreamPromise = fetchFromTmdb(tmdbUrl, env, request);
    inFlightRequests.set(requestKey, upstreamPromise);

    try {
      const upstreamResponse = await upstreamPromise;
      if (!upstreamResponse.ok) {
        return withCors(upstreamResponse, request, env, false);
      }

      const ttl = getCacheTtl(tmdbPath, env);
      const cacheable = new Response(upstreamResponse.body, upstreamResponse);
      cacheable.headers.set('Cache-Control', `public, max-age=${ttl}`);
      cacheable.headers.set('X-Cache', 'MISS');
      ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));

      return withCors(cacheable, request, env, false);
    } finally {
      inFlightRequests.delete(requestKey);
    }
  },
};

function handleOptions(request: Request, env: Env): Response {
  const headers = corsHeaders(request, env);
  if (!headers.has('Access-Control-Allow-Origin')) {
    return jsonError('Origin not allowed', 403, request, env);
  }
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(null, { status: 204, headers });
}

function validateOrigin(request: Request, env: Env): Response | null {
  const allowedOrigins = getAllowedOrigins(env);
  if (allowedOrigins.length === 0) {
    return jsonError('Proxy misconfigured: ALLOWED_ORIGIN is required', 500, request, env);
  }
  const clientOrigin = getClientOrigin(request);
  if (!clientOrigin) return jsonError('Origin or Referer header required', 403, request, env);
  if (allowedOrigins.includes(clientOrigin)) return null;
  return jsonError('Origin not allowed', 403, request, env);
}

function isAllowedPath(path: string): boolean {
  if (path === '/search/movie') return true;
  if (/^\/movie\/\d+$/.test(path)) return true;
  return false;
}

function buildTmdbUrl(path: string, searchParams: URLSearchParams): URL {
  const url = new URL(`${TMDB_BASE}${path}`);
  const allowedParams = new Set(['query', 'year', 'language', 'page', 'include_adult', 'append_to_response']);
  for (const [key, value] of searchParams.entries()) {
    if (allowedParams.has(key)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function fetchFromTmdb(tmdbUrl: URL, env: Env, request: Request): Promise<Response> {
  if (!env.TMDB_API_KEY?.trim()) {
    return jsonError('TMDB_API_KEY is missing', 500, request, env);
  }

  let response = await fetch(tmdbUrl.toString(), {
    headers: {
      Authorization: `Bearer ${env.TMDB_API_KEY}`,
      Accept: 'application/json',
    },
    cf: {
      cacheEverything: false,
    },
  });

  // Support both TMDb v4 Bearer tokens and v3 API keys.
  if (response.status === 401) {
    const fallbackUrl = new URL(tmdbUrl.toString());
    fallbackUrl.searchParams.set('api_key', env.TMDB_API_KEY);
    response = await fetch(fallbackUrl.toString(), {
      headers: { Accept: 'application/json' },
      cf: { cacheEverything: false },
    });
  }

  const cloned = new Response(response.body, response);
  cloned.headers.set('Content-Type', 'application/json; charset=utf-8');
  return cloned;
}

function getCacheTtl(path: string, env: Env): number {
  const searchTtl = toInt(env.CACHE_TTL_SEARCH_SECONDS, 600);
  const movieTtl = toInt(env.CACHE_TTL_MOVIE_SECONDS, 21600);
  return path === '/search/movie' ? searchTtl : movieTtl;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withCors(response: Response, request: Request, env: Env, fromCache: boolean): Response {
  const next = new Response(response.body, response);
  const headers = corsHeaders(request, env);
  headers.forEach((value, key) => next.headers.set(key, value));
  if (fromCache) {
    next.headers.set('X-Cache', 'HIT');
  } else if (!next.headers.has('X-Cache')) {
    next.headers.set('X-Cache', 'MISS');
  }
  return next;
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const requestOrigin = request.headers.get('origin');
  const origin = normalizeOrigin(requestOrigin);
  const allowedOrigins = getAllowedOrigins(env);
  if (origin && requestOrigin && allowedOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', requestOrigin);
  }
  headers.set('Vary', 'Origin');
  return headers;
}

function getClientOrigin(request: Request): string {
  const origin = normalizeOrigin(request.headers.get('origin'));
  if (origin) return origin;

  const explicitExtensionOrigin = normalizeOrigin(request.headers.get('x-lekkerboxd-origin'));
  if (explicitExtensionOrigin) return explicitExtensionOrigin;

  const referer = request.headers.get('referer');
  if (!referer) return '';
  try {
    return normalizeOrigin(new URL(referer).origin);
  } catch {
    return '';
  }
}

function getAllowedOrigins(env: Env): string[] {
  const raw = env.ALLOWED_ORIGIN?.trim() ?? '';
  if (!raw) return [];
  return raw
    .split(',')
    .map(value => normalizeOrigin(value))
    .filter(Boolean);
}

function normalizeOrigin(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

function jsonError(message: string, status: number, request: Request, env: Env): Response {
  const response = new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
  return withCors(response, request, env, false);
}
