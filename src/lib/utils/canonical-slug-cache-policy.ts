export interface CanonicalSlugCache {
  byTmdbId: Record<string, string>;
  bySlug: Record<string, string>;
}

export interface CanonicalSlugCachePatch {
  tmdbEntry?: [string, string];
  slugEntries: Array<[string, string]>;
}

interface ResolveCanonicalSlugWithCachePolicyInput {
  cache: CanonicalSlugCache;
  tmdbId: number;
  requestedSlug: string;
  contextual: boolean;
  verifyContext: (slug: string) => Promise<boolean>;
  resolveFresh: () => Promise<string>;
  confirmResolvedForCache?: (slug: string) => Promise<boolean>;
}

export interface ResolveCanonicalSlugWithCachePolicyResult {
  resolvedSlug: string;
  patch: CanonicalSlugCachePatch | null;
  source: 'tmdb-cache' | 'slug-cache' | 'fresh';
}

export async function resolveCanonicalSlugWithCachePolicy(
  input: ResolveCanonicalSlugWithCachePolicyInput,
): Promise<ResolveCanonicalSlugWithCachePolicyResult> {
  const tmdbKey = String(input.tmdbId);
  const tmdbCachedSlug = input.cache.byTmdbId[tmdbKey];

  if (tmdbCachedSlug) {
    if (!input.contextual) {
      return { resolvedSlug: tmdbCachedSlug, patch: null, source: 'tmdb-cache' };
    }
    if (await input.verifyContext(tmdbCachedSlug)) {
      return { resolvedSlug: tmdbCachedSlug, patch: null, source: 'tmdb-cache' };
    }
  }

  const slugCached = input.cache.bySlug[input.requestedSlug];
  if (slugCached) {
    if (!input.contextual) {
      return { resolvedSlug: slugCached, patch: null, source: 'slug-cache' };
    }
    if (await input.verifyContext(slugCached)) {
      const needsTmdbBackfill = input.cache.byTmdbId[tmdbKey] !== slugCached;
      return {
        resolvedSlug: slugCached,
        patch: needsTmdbBackfill
          ? { tmdbEntry: [tmdbKey, slugCached], slugEntries: [] }
          : null,
        source: 'slug-cache',
      };
    }
  }

  const freshResolved = await input.resolveFresh();

  if (input.contextual && freshResolved === input.requestedSlug) {
    const confirm = await (input.confirmResolvedForCache ?? input.verifyContext)(freshResolved);
    if (!confirm) {
      return {
        resolvedSlug: freshResolved,
        patch: null,
        source: 'fresh',
      };
    }
  }

  return {
    resolvedSlug: freshResolved,
    patch: {
      tmdbEntry: [tmdbKey, freshResolved],
      slugEntries: [
        [input.requestedSlug, freshResolved],
        [freshResolved, freshResolved],
      ],
    },
    source: 'fresh',
  };
}

export function applyCanonicalSlugCachePatch(
  cache: CanonicalSlugCache,
  patch: CanonicalSlugCachePatch,
): CanonicalSlugCache {
  const next: CanonicalSlugCache = {
    byTmdbId: { ...cache.byTmdbId },
    bySlug: { ...cache.bySlug },
  };

  if (patch.tmdbEntry) {
    next.byTmdbId[patch.tmdbEntry[0]] = patch.tmdbEntry[1];
  }

  for (const [fromSlug, toSlug] of patch.slugEntries) {
    next.bySlug[fromSlug] = toSlug;
  }

  return next;
}
