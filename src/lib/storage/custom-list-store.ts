/**
 * Storage module for custom Letterboxd list seed data.
 *
 * When the user pastes a Letterboxd list URL in settings, the service
 * worker scrapes that list and stores the films here so they can be
 * used as custom seeds for recommendation generation.
 */

import type { ScrapedFilm } from '../../types/letterboxd';

export interface CustomListData {
  /** The original Letterboxd list URL. */
  url: string;
  /** Scraped films from the list (capped at 30). */
  films: ScrapedFilm[];
  /** Total number of films on the list (before cap). */
  filmCount: number;
  /** Timestamp of the last successful scrape. */
  scrapedAt: number;
}

const CUSTOM_LIST_KEY = 'lb_rec_custom_list';

/** 1-hour TTL — re-scrape during generation if older. */
const CUSTOM_LIST_TTL = 60 * 60 * 1000;

export async function getCustomList(): Promise<CustomListData | null> {
  const result = await chrome.storage.local.get(CUSTOM_LIST_KEY);
  return (result[CUSTOM_LIST_KEY] as CustomListData) ?? null;
}

export async function saveCustomList(data: CustomListData): Promise<void> {
  await chrome.storage.local.set({ [CUSTOM_LIST_KEY]: data });
}

export async function clearCustomList(): Promise<void> {
  await chrome.storage.local.remove(CUSTOM_LIST_KEY);
}

export function isCustomListStale(data: CustomListData): boolean {
  return Date.now() - data.scrapedAt > CUSTOM_LIST_TTL;
}
