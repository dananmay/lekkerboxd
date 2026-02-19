import type { TmdbIdMapping } from '../../types/tmdb';
import type { RecommendationResult } from '../../types/recommendation';
import { withStorageLock } from './storage-mutex';

const TMDB_ID_CACHE_KEY = 'lb_rec_tmdb_ids';
const RECS_CACHE_PREFIX = 'lb_rec_recs_';
const RECS_TTL = 12 * 60 * 60 * 1000; // 12 hours

// TMDb ID mappings — cached permanently since they don't change
export async function getTmdbIdCache(): Promise<Map<string, number>> {
  const result = await chrome.storage.local.get(TMDB_ID_CACHE_KEY);
  const entries = result[TMDB_ID_CACHE_KEY] as [string, number][] | undefined;
  return new Map(entries ?? []);
}

export async function saveTmdbIdMapping(slug: string, tmdbId: number): Promise<void> {
  // Serialize read→merge→write to prevent concurrent saves from overwriting each other.
  await withStorageLock(TMDB_ID_CACHE_KEY, async () => {
    const cache = await getTmdbIdCache();
    cache.set(slug, tmdbId);
    await chrome.storage.local.set({
      [TMDB_ID_CACHE_KEY]: Array.from(cache.entries()),
    });
  });
}

export async function saveTmdbIdMappings(mappings: TmdbIdMapping[]): Promise<void> {
  await withStorageLock(TMDB_ID_CACHE_KEY, async () => {
    const cache = await getTmdbIdCache();
    for (const mapping of mappings) {
      cache.set(mapping.letterboxdSlug, mapping.tmdbId);
    }
    await chrome.storage.local.set({
      [TMDB_ID_CACHE_KEY]: Array.from(cache.entries()),
    });
  });
}

// Recommendation results cache
export async function getCachedRecommendations(
  username: string,
): Promise<RecommendationResult | null> {
  const key = RECS_CACHE_PREFIX + username.toLowerCase();
  const result = await chrome.storage.local.get(key);
  const cached = result[key] as RecommendationResult | undefined;
  if (!cached) return null;

  if (Date.now() - cached.generatedAt > RECS_TTL) {
    await chrome.storage.local.remove(key);
    return null;
  }

  return cached;
}

export async function cacheRecommendations(result: RecommendationResult): Promise<void> {
  const key = RECS_CACHE_PREFIX + result.username.toLowerCase();
  await chrome.storage.local.set({ [key]: result });
}
