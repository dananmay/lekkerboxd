export interface ScrapedFilm {
  slug: string;
  title: string;
  year: number | null;
  rating: number | null; // 0.5 to 5, in 0.5 increments
  liked: boolean;
  reviewed: boolean;
  posterUrl: string | null;
  letterboxdUrl: string;
}

export interface UserProfile {
  username: string;
  scrapedAt: number;
  watchedFilms: ScrapedFilm[];
  likedFilms: ScrapedFilm[];
  ratedFilms: ScrapedFilm[];
  watchlist: ScrapedFilm[];
}

export type ScrapeTarget = 'films' | 'likes' | 'ratings' | 'watchlist';

export interface ScrapeProgress {
  target: ScrapeTarget;
  currentPage: number;
  totalPages: number;
  filmsFound: number;
}
