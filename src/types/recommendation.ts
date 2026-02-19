export type RecommendationSource = 'tmdb-recommendation' | 'tmdb-similar' | 'reddit' | 'tasteio';

export interface RecommendationHit {
  source: RecommendationSource;
  seedFilmTitle: string;
  seedFilmSlug: string;
}

export interface Recommendation {
  tmdbId: number;
  title: string;
  year: number;
  overview: string;
  posterPath: string | null;
  tmdbRating: number;
  genres: string[];
  score: number;
  hits: RecommendationHit[];
  onWatchlist: boolean;
  letterboxdUrl: string;
}

export interface SourceError {
  source: string;
  error: string;
  seedsAffected: number;
}

export interface RecommendationResult {
  recommendations: Recommendation[];
  generatedAt: number;
  seedCount: number;
  username: string;
  sourceErrors?: SourceError[];
  /** Fingerprint of settings + profile state used to generate these results */
  settingsFingerprint?: string;
}
