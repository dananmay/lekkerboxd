export interface TmdbMovie {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  genre_ids: number[];
  popularity: number;
}

export interface TmdbMovieDetail extends TmdbMovie {
  genres: TmdbGenre[];
  runtime: number | null;
  imdb_id: string | null;
  recommendations?: { results: TmdbMovie[] };
  similar?: { results: TmdbMovie[] };
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbSearchResult {
  page: number;
  results: TmdbMovie[];
  total_pages: number;
  total_results: number;
}

export interface TmdbIdMapping {
  letterboxdSlug: string;
  tmdbId: number;
  title: string;
  year: number;
}
