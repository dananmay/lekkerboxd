import type { ScrapedFilm, ScrapeProgress, UserProfile } from './letterboxd';
import type { RecommendationResult } from './recommendation';

// Content script -> Background messages
export interface ScrapeProfileMessage {
  type: 'SCRAPE_PROFILE';
  username: string;
}

export interface ScrapedPageMessage {
  type: 'SCRAPED_PAGE';
  username: string;
  films: ScrapedFilm[];
  pageType: 'films' | 'likes' | 'ratings' | 'watchlist';
  page: number;
  totalPages: number;
}

export interface GetRecommendationsMessage {
  type: 'GET_RECOMMENDATIONS';
  username: string;
  forceRefresh?: boolean;
}

export interface GetFilmRecommendationsMessage {
  type: 'GET_FILM_RECOMMENDATIONS';
  filmSlug: string;
  filmTitle: string;
  filmYear: number | null;
}

export interface GetSettingsMessage {
  type: 'GET_SETTINGS';
}

export interface SaveSettingsMessage {
  type: 'SAVE_SETTINGS';
  settings: {
    tmdbApiKey?: string;
    launchMode?: 'popup' | 'window';
    justWatchRegion?: string;
    letterboxdUsername?: string;
    maxSeeds?: number;
    maxRecommendations?: number;
    popularityFilter?: number;
  };
}

export interface OpenAppWindowMessage {
  type: 'OPEN_APP_WINDOW';
}

export interface GetProfileMessage {
  type: 'GET_PROFILE';
  username: string;
}

export interface LoggedInUserMessage {
  type: 'LOGGED_IN_USER';
  username: string;
}

export interface AddToWatchlistMessage {
  type: 'ADD_TO_WATCHLIST';
  filmSlug: string;
  filmTitle?: string;
  filmYear?: number;
}

export interface OpenLetterboxdFilmMessage {
  type: 'OPEN_LETTERBOXD_FILM';
  tmdbId: number;
  filmSlug: string;
  filmTitle?: string;
  filmYear?: number;
}

export interface GetGeneratingStatusMessage {
  type: 'GET_GENERATING_STATUS';
}

export interface GetServiceHealthMessage {
  type: 'GET_SERVICE_HEALTH';
}

// Background -> Content script / Popup messages
export interface ScrapeProgressMessage {
  type: 'SCRAPE_PROGRESS';
  progress: ScrapeProgress;
}

export interface ProfileReadyMessage {
  type: 'PROFILE_READY';
  profile: UserProfile;
}

export interface RecommendationsReadyMessage {
  type: 'RECOMMENDATIONS_READY';
  result: RecommendationResult;
}

export interface ErrorMessage {
  type: 'ERROR';
  error: string;
}

export type MessageToBackground =
  | ScrapeProfileMessage
  | ScrapedPageMessage
  | GetRecommendationsMessage
  | GetFilmRecommendationsMessage
  | GetSettingsMessage
  | SaveSettingsMessage
  | OpenAppWindowMessage
  | GetProfileMessage
  | LoggedInUserMessage
  | AddToWatchlistMessage
  | OpenLetterboxdFilmMessage
  | GetGeneratingStatusMessage
  | GetServiceHealthMessage;

export type MessageFromBackground =
  | ScrapeProgressMessage
  | ProfileReadyMessage
  | RecommendationsReadyMessage
  | ErrorMessage;
