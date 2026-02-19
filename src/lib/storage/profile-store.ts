import type { UserProfile, ScrapedFilm } from '../../types/letterboxd';
import { withStorageLock } from './storage-mutex';

const PROFILE_KEY_PREFIX = 'lb_rec_profile_';
const PROFILE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function getProfile(username: string): Promise<UserProfile | null> {
  const key = PROFILE_KEY_PREFIX + username.toLowerCase();
  const result = await chrome.storage.local.get(key);
  const profile = result[key] as UserProfile | undefined;
  if (!profile) return null;

  // Check TTL
  if (Date.now() - profile.scrapedAt > PROFILE_TTL) {
    await chrome.storage.local.remove(key);
    return null;
  }

  return profile;
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  const key = PROFILE_KEY_PREFIX + profile.username.toLowerCase();
  await chrome.storage.local.set({ [key]: profile });
}

export async function updateProfileFilms(
  username: string,
  pageType: 'films' | 'likes' | 'ratings' | 'watchlist',
  films: ScrapedFilm[],
): Promise<UserProfile> {
  // Serialize read→merge→write per user to prevent lost-update races
  // when multiple pages are scraped concurrently.
  return withStorageLock('profile:' + username.toLowerCase(), async () => {
    const existing = await getProfile(username);
    const profile: UserProfile = existing ?? {
      username,
      scrapedAt: Date.now(),
      watchedFilms: [],
      likedFilms: [],
      ratedFilms: [],
      watchlist: [],
    };

    // Merge films by slug to avoid duplicates
    const merge = (existing: ScrapedFilm[], incoming: ScrapedFilm[]): ScrapedFilm[] => {
      const map = new Map(existing.map(f => [f.slug, f]));
      for (const film of incoming) {
        map.set(film.slug, film);
      }
      return Array.from(map.values());
    };

    switch (pageType) {
      case 'films':
        profile.watchedFilms = merge(profile.watchedFilms, films);
        break;
      case 'likes':
        profile.likedFilms = merge(profile.likedFilms, films);
        break;
      case 'ratings':
        // Only store films that actually have a rating value
        profile.ratedFilms = merge(profile.ratedFilms, films.filter(f => f.rating !== null));
        break;
      case 'watchlist':
        profile.watchlist = merge(profile.watchlist, films);
        break;
    }

    profile.scrapedAt = Date.now();
    await saveProfile(profile);
    return profile;
  });
}
