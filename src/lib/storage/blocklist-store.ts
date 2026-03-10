import { withStorageLock } from './storage-mutex';

export interface BlockedFilm {
  tmdbId: number;
  title: string;
  year: number;
  posterPath: string | null;
  blockedAt: number;
}

const BLOCKLIST_KEY = 'lb_rec_blocklist';

export async function getBlocklist(): Promise<BlockedFilm[]> {
  const result = await chrome.storage.local.get(BLOCKLIST_KEY);
  return (result[BLOCKLIST_KEY] as BlockedFilm[]) ?? [];
}

export async function addToBlocklist(film: BlockedFilm): Promise<void> {
  await withStorageLock(BLOCKLIST_KEY, async () => {
    const list = await getBlocklist();
    if (list.some(f => f.tmdbId === film.tmdbId)) return;
    list.push(film);
    await chrome.storage.local.set({ [BLOCKLIST_KEY]: list });
  });
}

export async function removeFromBlocklist(tmdbId: number): Promise<void> {
  await withStorageLock(BLOCKLIST_KEY, async () => {
    const list = await getBlocklist();
    const updated = list.filter(f => f.tmdbId !== tmdbId);
    await chrome.storage.local.set({ [BLOCKLIST_KEY]: updated });
  });
}
