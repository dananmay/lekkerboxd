export type PopularityFilter = 0 | 1 | 2 | 3;

export interface Settings {
  tmdbApiKey: string;
  launchMode: 'popup' | 'window';
  justWatchRegion: string;
  letterboxdUsername: string;
  maxSeeds: number;
  maxRecommendations: number;
  popularityFilter: PopularityFilter;
}

const SETTINGS_KEY = 'lb_rec_settings';

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = (result[SETTINGS_KEY] ?? {}) as Partial<Settings> & Record<string, unknown>;
  return {
    tmdbApiKey: typeof stored.tmdbApiKey === 'string' ? stored.tmdbApiKey : '',
    launchMode: stored.launchMode === 'window' ? 'window' : 'popup',
    justWatchRegion: typeof stored.justWatchRegion === 'string' ? stored.justWatchRegion : 'auto',
    letterboxdUsername: typeof stored.letterboxdUsername === 'string' ? stored.letterboxdUsername : '',
    maxSeeds: typeof stored.maxSeeds === 'number' && stored.maxSeeds > 0 ? stored.maxSeeds : 15,
    maxRecommendations: typeof stored.maxRecommendations === 'number' && stored.maxRecommendations > 0 ? stored.maxRecommendations : 20,
    popularityFilter: typeof stored.popularityFilter === 'number' ? stored.popularityFilter as PopularityFilter : 1,
  };
}

export async function saveSettings(settings: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const updated: Settings = {
    tmdbApiKey: settings.tmdbApiKey ?? current.tmdbApiKey,
    launchMode: settings.launchMode ?? current.launchMode,
    justWatchRegion: settings.justWatchRegion ?? current.justWatchRegion,
    letterboxdUsername: settings.letterboxdUsername ?? current.letterboxdUsername,
    maxSeeds: settings.maxSeeds ?? current.maxSeeds,
    maxRecommendations: settings.maxRecommendations ?? current.maxRecommendations,
    popularityFilter: settings.popularityFilter ?? current.popularityFilter,
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
  return updated;
}
