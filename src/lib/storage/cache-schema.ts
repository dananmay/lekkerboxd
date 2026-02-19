const CACHE_SCHEMA_KEY = 'lb_rec_cache_schema';
const CACHE_SCHEMA_VERSION = 1;

interface CacheSchemaMeta {
  version: number;
  updatedAt: number;
}

/**
 * Read-only-friendly schema metadata hook.
 *
 * This intentionally does not mutate or invalidate existing caches.
 * It only records the current schema version key for future migrations.
 */
export async function ensureCacheSchemaMetadata(): Promise<CacheSchemaMeta> {
  const result = await chrome.storage.local.get(CACHE_SCHEMA_KEY);
  const existing = result[CACHE_SCHEMA_KEY] as CacheSchemaMeta | undefined;

  if (existing && existing.version === CACHE_SCHEMA_VERSION) {
    return existing;
  }

  const meta: CacheSchemaMeta = {
    version: CACHE_SCHEMA_VERSION,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [CACHE_SCHEMA_KEY]: meta });
  return meta;
}
