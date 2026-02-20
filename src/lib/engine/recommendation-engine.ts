import type { ScrapedFilm, UserProfile } from '../../types/letterboxd';
import type { TmdbMovie, TmdbMovieDetail } from '../../types/tmdb';
import type { Recommendation, RecommendationHit, RecommendationResult, RecommendationSource, SourceError } from '../../types/recommendation';
import { getMovieWithRecommendations, batchResolveTmdbIds, searchMovie } from '../api/tmdb-client';
import { searchRedditForMovieRecs } from '../api/reddit-client';
import { getTasteioSimilar } from '../api/tasteio-client';
import { letterboxdFilmUrl } from '../utils/url-utils';

const DEFAULT_MAX_SEEDS = 15;
const DEFAULT_MAX_RECOMMENDATIONS = 20;
const DEFAULT_FILM_PAGE_MAX_RECOMMENDATIONS = 8;
const SEED_TOP_WEIGHT_BOOST = 0.2;
const SEED_PRIORITY_BONUS_MAX = 10;
const NORMALIZE_IF_MAX_ABOVE = 105;

interface PipelineConfig {
  tmdbSeedBatchSize: number;
  tmdbRecommendationsPerSeed: number;
  tmdbSimilarPerSeed: number;
  externalSeedMin: number;
  externalSeedRatio: number;
  redditRecsPerSeed: number;
  tasteioRecsPerSeed: number;
  externalTitleResolveMultiplier: number;
  externalTitleResolveMin: number;
  externalCanIntroduceCandidates: boolean;
}

const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  tmdbSeedBatchSize: 10,
  tmdbRecommendationsPerSeed: 20,
  tmdbSimilarPerSeed: 20,
  externalSeedMin: 4,
  externalSeedRatio: 0.4,
  redditRecsPerSeed: 6,
  tasteioRecsPerSeed: 10,
  externalTitleResolveMultiplier: 3,
  externalTitleResolveMin: 40,
  externalCanIntroduceCandidates: true,
};

const FILM_PAGE_PIPELINE_CONFIG: PipelineConfig = {
  tmdbSeedBatchSize: 1,
  tmdbRecommendationsPerSeed: 10,
  tmdbSimilarPerSeed: 8,
  externalSeedMin: 1,
  externalSeedRatio: 1,
  redditRecsPerSeed: 3,
  tasteioRecsPerSeed: 4,
  externalTitleResolveMultiplier: 2,
  externalTitleResolveMin: 12,
  // Keep film-page overlays tightly relevant to the current title:
  // external sources can reinforce TMDb candidates but cannot introduce new ones.
  externalCanIntroduceCandidates: false,
};

export interface RecommendationOptions {
  maxSeeds?: number;
  maxRecommendations?: number;
  popularityFilter?: number;
}

interface ScoredCandidate {
  tmdbId: number;
  title: string;
  year: number;
  overview: string;
  posterPath: string | null;
  tmdbRating: number;
  voteCount: number;
  popularity: number;
  genres: string[];
  hits: RecommendationHit[];
  letterboxdSlug: string;
}

interface RankedRecommendation {
  recommendation: Recommendation;
  baseScore: number;
  boostedScore: number;
  finalScore: number;
}

export async function generateRecommendations(
  profile: UserProfile,
  apiKey: string,
  onProgress?: (stage: string, pct: number) => void,
  options?: RecommendationOptions,
): Promise<RecommendationResult> {
  const maxSeeds = options?.maxSeeds ?? DEFAULT_MAX_SEEDS;
  const maxRecommendations = options?.maxRecommendations ?? DEFAULT_MAX_RECOMMENDATIONS;
  const popularityFilter = options?.popularityFilter ?? 1;

  const seeds = selectSeeds(profile, maxSeeds);
  return generateRecommendationsFromSeeds(
    profile,
    apiKey,
    seeds,
    maxRecommendations,
    popularityFilter,
    DEFAULT_PIPELINE_CONFIG,
    onProgress,
  );
}

export async function generateSingleSeedRecommendations(
  profile: UserProfile,
  apiKey: string,
  seed: ScrapedFilm,
  onProgress?: (stage: string, pct: number) => void,
  options?: RecommendationOptions,
): Promise<RecommendationResult> {
  const maxRecommendations = options?.maxRecommendations ?? DEFAULT_FILM_PAGE_MAX_RECOMMENDATIONS;
  const popularityFilter = options?.popularityFilter ?? 1;
  return generateRecommendationsFromSeeds(
    profile,
    apiKey,
    [seed],
    maxRecommendations,
    popularityFilter,
    FILM_PAGE_PIPELINE_CONFIG,
    onProgress,
  );
}

async function generateRecommendationsFromSeeds(
  profile: UserProfile,
  apiKey: string,
  seeds: ScrapedFilm[],
  maxRecommendations: number,
  popularityFilter: number,
  pipeline: PipelineConfig,
  onProgress?: (stage: string, pct: number) => void,
): Promise<RecommendationResult> {
  // 1. Select/provide seed films
  const seedWeightsBySlug = buildSeedWeightMap(seeds);
  onProgress?.('Selecting seed films', 10);

  // Fail fast with a clear error if TMDb/proxy connectivity is broken.
  // Without this, downstream all-settled flows can degrade into empty results
  // with no visible error in the popup.
  if (seeds.length > 0) {
    try {
      await searchMovie(apiKey, seeds[0].title, seeds[0].year);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`TMDb connectivity check failed: ${message}`);
    }
  }

  // 2. Resolve TMDb IDs for seeds (parallel batches of 4)
  const seedsForResolution = seeds.map(s => ({
    slug: s.slug,
    title: s.title,
    year: s.year,
  }));
  const tmdbIds = await batchResolveTmdbIds(apiKey, seedsForResolution);
  onProgress?.('Resolved TMDb IDs', 20);

  // 3. Build watched set for exclusion (slug-based + tmdbId-based)
  const watchedSlugs = new Set(profile.watchedFilms.map(f => f.slug));
  const watchedNormalizedTitles = new Set(
    profile.watchedFilms
      .map(f => normalizeForComparison(f.title))
      .filter(Boolean),
  );
  const watchlistSlugs = new Set(profile.watchlist.map(f => f.slug));

  // Also build a set of TMDb IDs for watched films we already resolved (seeds are watched)
  const watchedTmdbIds = new Set<number>();
  for (const film of profile.watchedFilms) {
    const id = tmdbIds.get(film.slug);
    if (id) watchedTmdbIds.add(id);
  }

  // 4. Gather candidates from TMDb (larger batches reduce round-trip overhead)
  const candidates = new Map<number, ScoredCandidate>();
  const seedsWithIds = seeds
    .map(seed => ({ seed, tmdbId: tmdbIds.get(seed.slug) }))
    .filter((s): s is { seed: ScrapedFilm; tmdbId: number } => s.tmdbId !== undefined);

  for (let i = 0; i < seedsWithIds.length; i += pipeline.tmdbSeedBatchSize) {
    const batch = seedsWithIds.slice(i, i + pipeline.tmdbSeedBatchSize);
    const results = await Promise.allSettled(
      batch.map(({ tmdbId }) => getMovieWithRecommendations(apiKey, tmdbId)),
    );
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        addTmdbCandidates(
          candidates,
          result.value,
          batch[idx].seed,
          pipeline.tmdbRecommendationsPerSeed,
          pipeline.tmdbSimilarPerSeed,
        );
      }
    });
    const processed = Math.min(i + pipeline.tmdbSeedBatchSize, seedsWithIds.length);
    onProgress?.(
      `Processing seeds (${processed}/${seedsWithIds.length})`,
      20 + (processed / seedsWithIds.length) * 35,
    );
  }

  // 5. Gather candidates from Reddit + Taste.io concurrently
  onProgress?.('Searching Reddit & Taste.io', 55);
  const sourceErrors: SourceError[] = [];
  const externalSeedCount = Math.min(
    seeds.length,
    Math.max(pipeline.externalSeedMin, Math.ceil(seeds.length * pipeline.externalSeedRatio)),
  );
  const externalSeeds = seeds.slice(0, externalSeedCount);

  const [redditResults, tasteioResults] = await Promise.all([
    Promise.allSettled(
      externalSeeds.map(seed =>
        searchRedditForMovieRecs(seed.title).then(recs => ({ seed, recs })),
      ),
    ),
    Promise.allSettled(
      externalSeeds.map(seed =>
        getTasteioSimilar(seed.title).then(recs => ({ seed, recs })),
      ),
    ),
  ]);

  // Track source failures
  const redditFailures = redditResults.filter(r => r.status === 'rejected').length;
  const tasteioFailures = tasteioResults.filter(r => r.status === 'rejected').length;

  if (redditFailures === externalSeeds.length) {
    sourceErrors.push({ source: 'Reddit', error: 'All Reddit requests failed — service may be unreachable', seedsAffected: redditFailures });
  } else if (redditFailures > 0) {
    sourceErrors.push({ source: 'Reddit', error: `${redditFailures}/${externalSeeds.length} Reddit searches failed`, seedsAffected: redditFailures });
  }

  if (tasteioFailures === externalSeeds.length) {
    sourceErrors.push({ source: 'Taste.io', error: 'All Taste.io requests failed — service may be unreachable', seedsAffected: tasteioFailures });
  } else if (tasteioFailures > 0) {
    sourceErrors.push({ source: 'Taste.io', error: `${tasteioFailures}/${externalSeeds.length} Taste.io searches failed`, seedsAffected: tasteioFailures });
  }

  if (sourceErrors.length > 0) {
    console.warn('[Lekkerboxd] Source errors:', sourceErrors);
  }

  onProgress?.('Resolving candidates', 70);

  // 6. Resolve unique movie titles from Reddit + Taste.io to TMDb.
  // Cap volume so external lookups do not dominate runtime.
  const titlesToResolve = new Map<string, { title: string; year?: number }>();
  const maxTitlesToResolve = Math.max(
    maxRecommendations * pipeline.externalTitleResolveMultiplier,
    pipeline.externalTitleResolveMin,
  );

  const addTitleToResolve = (key: string, value: { title: string; year?: number }): boolean => {
    if (titlesToResolve.has(key)) return true;
    if (titlesToResolve.size >= maxTitlesToResolve) return false;
    titlesToResolve.set(key, value);
    return true;
  };

  for (const result of redditResults) {
    if (result.status !== 'fulfilled') continue;
    for (const rec of result.value.recs.slice(0, pipeline.redditRecsPerSeed)) {
      const key = rec.movieTitle.toLowerCase();
      if (!addTitleToResolve(key, { title: rec.movieTitle })) break;
    }
    if (titlesToResolve.size >= maxTitlesToResolve) break;
  }

  if (titlesToResolve.size < maxTitlesToResolve) {
    for (const result of tasteioResults) {
      if (result.status !== 'fulfilled') continue;
      for (const rec of result.value.recs.slice(0, pipeline.tasteioRecsPerSeed)) {
        const key = rec.title.toLowerCase();
        if (!addTitleToResolve(key, { title: rec.title, year: rec.year || undefined })) break;
      }
      if (titlesToResolve.size >= maxTitlesToResolve) break;
    }
  }

  // Resolve all titles concurrently; TMDb client rate-limiter enforces throughput.
  const titleToMovie = new Map<string, TmdbMovie>();
  const titleEntries = Array.from(titlesToResolve.entries());
  if (titleEntries.length > 0) {
    const results = await Promise.allSettled(
      titleEntries.map(([, info]) => searchMovie(apiKey, info.title, info.year)),
    );
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) {
        const info = titleEntries[idx][1];
        if (isConfidentExternalTmdbMatch(info.title, info.year, result.value)) {
          titleToMovie.set(titleEntries[idx][0], result.value);
        }
      }
    });
  }
  onProgress?.('Building candidates', 85);

  // Add Reddit candidates using pre-resolved movies
  for (const result of redditResults) {
    if (result.status !== 'fulfilled') continue;
    const { seed, recs } = result.value;
    for (const rec of recs.slice(0, pipeline.redditRecsPerSeed)) {
      const movie = titleToMovie.get(rec.movieTitle.toLowerCase());
      if (!movie) continue;
      if (!pipeline.externalCanIntroduceCandidates && !candidates.has(movie.id)) continue;
      addResolvedCandidate(candidates, movie, seed, 'reddit');
    }
  }

  // Add Taste.io candidates using pre-resolved movies
  for (const result of tasteioResults) {
    if (result.status !== 'fulfilled') continue;
    const { seed, recs } = result.value;
    for (const rec of recs.slice(0, pipeline.tasteioRecsPerSeed)) {
      const movie = titleToMovie.get(rec.title.toLowerCase());
      if (!movie) continue;
      if (!pipeline.externalCanIntroduceCandidates && !candidates.has(movie.id)) continue;
      addResolvedCandidate(candidates, movie, seed, 'tasteio');
    }
  }

  // 7. Filter and score
  const scored = scoreAndRank(
    candidates,
    watchedSlugs,
    watchedNormalizedTitles,
    watchlistSlugs,
    watchedTmdbIds,
    seedWeightsBySlug,
    maxRecommendations,
    popularityFilter,
  );
  onProgress?.('Ranking results', 95);

  const result: RecommendationResult = {
    recommendations: scored,
    generatedAt: Date.now(),
    seedCount: seeds.length,
    username: profile.username,
    sourceErrors: sourceErrors.length > 0 ? sourceErrors : undefined,
  };

  // Caching is now handled by the service worker (after stamping the settings fingerprint)
  onProgress?.('Done', 100);

  return result;
}

function selectSeeds(profile: UserProfile, maxSeeds: number): ScrapedFilm[] {
  const filmMap = new Map<string, ScrapedFilm>();

  for (const film of profile.likedFilms) {
    const existing = filmMap.get(film.slug);
    filmMap.set(film.slug, { ...film, liked: true, rating: existing?.rating ?? film.rating });
  }

  for (const film of profile.ratedFilms) {
    const existing = filmMap.get(film.slug);
    filmMap.set(film.slug, {
      ...film,
      liked: existing?.liked ?? film.liked,
    });
  }

  const allFilms = Array.from(filmMap.values());

  allFilms.sort((a, b) => {
    const scoreA = (a.rating ?? 0) + (a.liked ? 0.5 : 0);
    const scoreB = (b.rating ?? 0) + (b.liked ? 0.5 : 0);
    return scoreB - scoreA;
  });

  return allFilms.slice(0, maxSeeds);
}

function seedScore(film: Pick<ScrapedFilm, 'rating' | 'liked'>): number {
  return (film.rating ?? 0) + (film.liked ? 0.5 : 0);
}

export function buildSeedWeightMap(seeds: ScrapedFilm[]): Map<string, number> {
  const weights = new Map<string, number>();
  if (seeds.length === 0) return weights;

  const groupedByScore = new Map<number, string[]>();
  for (const seed of seeds) {
    const score = seedScore(seed);
    const slugs = groupedByScore.get(score) ?? [];
    slugs.push(seed.slug);
    groupedByScore.set(score, slugs);
  }

  const sortedScores = Array.from(groupedByScore.keys()).sort((a, b) => b - a);
  if (sortedScores.length <= 1) {
    for (const seed of seeds) weights.set(seed.slug, 1);
    return weights;
  }

  for (let i = 0; i < sortedScores.length; i += 1) {
    const score = sortedScores[i];
    const t = i / (sortedScores.length - 1);
    const weight = 1 + SEED_TOP_WEIGHT_BOOST * (1 - t);
    for (const slug of groupedByScore.get(score) ?? []) {
      weights.set(slug, weight);
    }
  }

  return weights;
}

function addTmdbCandidates(
  candidates: Map<number, ScoredCandidate>,
  detail: TmdbMovieDetail,
  seed: ScrapedFilm,
  maxRecommendationsPerSeed: number,
  maxSimilarPerSeed: number,
): void {
  const sources = [
    {
      movies: (detail.recommendations?.results ?? []).slice(0, maxRecommendationsPerSeed),
      type: 'tmdb-recommendation' as const,
    },
    {
      movies: (detail.similar?.results ?? []).slice(0, maxSimilarPerSeed),
      type: 'tmdb-similar' as const,
    },
  ];

  for (const { movies, type } of sources) {
    for (const movie of movies) {
      addResolvedCandidate(candidates, movie, seed, type);
    }
  }
}

// Generate a Letterboxd slug candidate from title only.
// Some films use year-disambiguated slugs, but title-only provides the most
// broadly compatible default URL path for opening film pages.
export function slugifyLetterboxdTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+$/, '')
    .replace(/^-+/, '');
}

function generateLegacyAsciiSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').replace(/^-+/, '');
}

export function normalizeForComparison(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Keep words inside parentheses but remove punctuation wrappers.
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeExternalTitleForMatch(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMovieYear(releaseDate: string): number | null {
  if (!releaseDate) return null;
  const year = parseInt(releaseDate.split('-')[0], 10);
  return Number.isFinite(year) ? year : null;
}

function tokenOverlapRatio(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const aUnique = new Set(aTokens);
  const bUnique = new Set(bTokens);
  let overlap = 0;
  for (const token of aUnique) {
    if (bUnique.has(token)) overlap += 1;
  }
  return overlap / Math.max(aUnique.size, bUnique.size);
}

export function isConfidentExternalTmdbMatch(
  queryTitle: string,
  queryYear: number | undefined,
  movie: TmdbMovie,
): boolean {
  const normalizedQuery = normalizeExternalTitleForMatch(queryTitle);
  const normalizedMovie = normalizeExternalTitleForMatch(movie.title);
  if (!normalizedQuery || !normalizedMovie) return false;

  const movieYear = extractMovieYear(movie.release_date);
  if (queryYear && movieYear && movieYear !== queryYear) return false;
  if (normalizedQuery === normalizedMovie) return true;

  const queryTokens = normalizedQuery.split(' ');
  const movieTokens = normalizedMovie.split(' ');
  if (queryTokens.length < 2 || movieTokens.length < 2) return false;
  if (queryTokens[0] !== movieTokens[0]) return false;

  return tokenOverlapRatio(queryTokens, movieTokens) >= 0.8;
}

function addResolvedCandidate(
  candidates: Map<number, ScoredCandidate>,
  movie: TmdbMovie,
  seed: ScrapedFilm,
  source: RecommendationSource,
): void {
  const hit: RecommendationHit = {
    source,
    seedFilmTitle: seed.title,
    seedFilmSlug: seed.slug,
  };

  const existing = candidates.get(movie.id);
  if (existing) {
    existing.hits.push(hit);
  } else {
    candidates.set(movie.id, {
      tmdbId: movie.id,
      title: movie.title,
      year: movie.release_date ? parseInt(movie.release_date.split('-')[0]) : 0,
      overview: movie.overview,
      posterPath: movie.poster_path,
      tmdbRating: movie.vote_average,
      voteCount: movie.vote_count ?? 0,
      popularity: movie.popularity ?? 0,
      genres: movie.genre_ids?.map(id => GENRE_MAP[id] || 'Unknown') ?? [],
      hits: [hit],
      letterboxdSlug: slugifyLetterboxdTitle(movie.title),
    });
  }
}

function scoreAndRank(
  candidates: Map<number, ScoredCandidate>,
  watchedSlugs: Set<string>,
  watchedNormalizedTitles: Set<string>,
  watchlistSlugs: Set<string>,
  watchedTmdbIds: Set<number>,
  seedWeightsBySlug: Map<string, number>,
  maxRecommendations: number,
  popularityFilter: number,
): Recommendation[] {
  const ranked: RankedRecommendation[] = [];

  for (const candidate of candidates.values()) {
    // Two-layer watched exclusion:
    // 1. Exact TMDb ID match (most reliable — catches same film resolved via different titles)
    if (watchedTmdbIds.has(candidate.tmdbId)) continue;
    // 2. Slug match — check both with-year and bare slug against Letterboxd's watched set
    if (watchedSlugs.has(candidate.letterboxdSlug)) continue;
    const bareSlug = slugifyLetterboxdTitle(candidate.title);
    const legacyBareSlug = generateLegacyAsciiSlug(candidate.title);
    if (bareSlug !== candidate.letterboxdSlug && watchedSlugs.has(bareSlug)) continue;
    if (legacyBareSlug !== bareSlug && watchedSlugs.has(legacyBareSlug)) continue;
    // 3. Conservative title-collision exclusion for punctuation/format variants.
    const normalizedTitle = normalizeForComparison(candidate.title);
    if (normalizedTitle && watchedNormalizedTitles.has(normalizedTitle)) continue;

    // Level 3: hard-exclude films with >5000 votes
    if (popularityFilter === 3 && candidate.voteCount > 5000) continue;

    const onWatchlist =
      watchlistSlugs.has(candidate.letterboxdSlug)
      || watchlistSlugs.has(bareSlug)
      || (legacyBareSlug !== bareSlug && watchlistSlugs.has(legacyBareSlug));
    const baseScore = calculateScore(candidate, popularityFilter);
    const uniqueSeedSlugs = new Set(candidate.hits.map(hit => hit.seedFilmSlug));
    const appliedBonusPoints = calculateCappedSeedBoostPoints(baseScore, uniqueSeedSlugs, seedWeightsBySlug);
    const boostedScore = baseScore + appliedBonusPoints;

    ranked.push({
      baseScore,
      boostedScore,
      finalScore: 0,
      recommendation: {
        tmdbId: candidate.tmdbId,
        title: candidate.title,
        year: candidate.year,
        overview: candidate.overview,
        posterPath: candidate.posterPath,
        tmdbRating: candidate.tmdbRating,
        genres: candidate.genres,
        score: 0,
        hits: candidate.hits,
        onWatchlist,
        letterboxdUrl: letterboxdFilmUrl(candidate.letterboxdSlug),
      },
    });
  }

  const normalizedScores = normalizeBoostedScores(ranked.map(item => item.boostedScore));
  ranked.forEach((item, idx) => {
    const normalized = normalizedScores[idx] ?? 0;
    item.finalScore = Math.max(0, Math.min(100, Math.round(normalized)));
    item.recommendation.score = item.finalScore;
  });

  ranked.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    if (b.baseScore !== a.baseScore) return b.baseScore - a.baseScore;
    if (b.recommendation.tmdbRating !== a.recommendation.tmdbRating) {
      return b.recommendation.tmdbRating - a.recommendation.tmdbRating;
    }
    return a.recommendation.title.localeCompare(b.recommendation.title);
  });
  return ranked.slice(0, maxRecommendations).map(item => item.recommendation);
}

export function calculateAverageSeedRelativeBonusPctFromSeedSlugs(
  seedSlugs: Iterable<string>,
  seedWeightsBySlug: ReadonlyMap<string, number>,
): number {
  const uniqueSeedSlugs = new Set(seedSlugs);
  if (uniqueSeedSlugs.size === 0) return 0;

  let pctTotal = 0;
  for (const slug of uniqueSeedSlugs) {
    const weight = seedWeightsBySlug.get(slug) ?? 1;
    pctTotal += Math.max(0, weight - 1);
  }
  return pctTotal / uniqueSeedSlugs.size;
}

export function calculateCappedSeedBoostPoints(
  baseScore: number,
  seedSlugs: Iterable<string>,
  seedWeightsBySlug: ReadonlyMap<string, number>,
): number {
  if (baseScore <= 0) return 0;
  const avgBonusPct = calculateAverageSeedRelativeBonusPctFromSeedSlugs(seedSlugs, seedWeightsBySlug);
  if (avgBonusPct <= 0) return 0;
  return Math.min(SEED_PRIORITY_BONUS_MAX, baseScore * avgBonusPct);
}

export function normalizeBoostedScores(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const maxBoosted = Math.max(...scores);
  if (!Number.isFinite(maxBoosted) || maxBoosted <= NORMALIZE_IF_MAX_ABOVE) return scores;

  const scale = 100 / maxBoosted;
  return scores.map(score => score * scale);
}

// Positive component weights per filter level.
// Scaled so that (positive max − max penalty) = 100 at every level.
// Level 0: sum 100, penalty 0  → net max 100
// Level 1: sum 126, penalty 26 → net max 100  (scale ×1.26)
// Level 2: sum 142, penalty 42 → net max 100  (scale ×1.42)
// Level 3: sum 120, penalty 20 → net max 100  (scale ×1.20)
const SCORING_WEIGHTS = {
  0: { multi: 38, freq: 25, source: 25, rating: 12 },          // total 100
  1: { multi: 47.88, freq: 31.5, source: 31.5, rating: 15.12 }, // total 126
  2: { multi: 53.96, freq: 35.5, source: 35.5, rating: 17.04 }, // total 142
  3: { multi: 45.6, freq: 30, source: 30, rating: 14.4 },      // total 120
} as const;

function calculateScore(candidate: ScoredCandidate, popularityFilter: number): number {
  const w = SCORING_WEIGHTS[popularityFilter as keyof typeof SCORING_WEIGHTS] ?? SCORING_WEIGHTS[1];
  let score = 0;

  // Frequency bonus
  const uniqueSeeds = new Set(candidate.hits.map(h => h.seedFilmSlug));
  score += Math.min(w.freq, uniqueSeeds.size * (w.freq / 2.5));

  // Source weight
  const tmdbRecHits = candidate.hits.filter(h => h.source === 'tmdb-recommendation').length;
  const tmdbSimHits = candidate.hits.filter(h => h.source === 'tmdb-similar').length;
  const redditHits = candidate.hits.filter(h => h.source === 'reddit').length;
  const tasteioHits = candidate.hits.filter(h => h.source === 'tasteio').length;
  const sourceScale = w.source / 25;
  score += Math.min(w.source, (tmdbRecHits * 8 + tasteioHits * 8 + redditHits * 6 + tmdbSimHits * 5) * sourceScale);

  // TMDb rating
  score += (candidate.tmdbRating / 10) * w.rating;

  // Multi-source bonus
  const sourceTypes = new Set(candidate.hits.map(h => h.source));
  score += Math.min(w.multi, (sourceTypes.size - 1) * (w.multi / 2));

  // Popularity penalty — varies by filter level
  if (popularityFilter === 1) {
    // Moderate
    if (candidate.voteCount > 10000) score -= 26;
    else if (candidate.voteCount > 5000) score -= 17;
    else if (candidate.voteCount > 2000) score -= 10;
  } else if (popularityFilter === 2) {
    // Aggressive
    if (candidate.voteCount > 10000) score -= 42;
    else if (candidate.voteCount > 5000) score -= 30;
    else if (candidate.voteCount > 2000) score -= 18;
    else if (candidate.voteCount > 500) score -= 7;
  } else if (popularityFilter === 3) {
    // Hidden gems — hard filtering done in scoreAndRank, penalize within remaining
    if (candidate.voteCount > 2000) score -= 20;
    else if (candidate.voteCount > 500) score -= 8;
  }
  // Level 0: no penalty applied

  return Math.round(Math.max(0, Math.min(100, score)));
}

// TMDb genre ID -> name mapping
const GENRE_MAP: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
  80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
};
