import { parseFilmsFromHTML, parsePaginationFromHTML } from '../src/content/scraper/pagination';
import {
  extractUsername,
  isFilmPage,
  extractFilmSlug,
  letterboxdFilmUrl,
  getProfilePageUrl,
} from '../src/lib/utils/url-utils';
import {
  normalizeForComparison,
  buildSeedWeightMap,
  calculateAverageSeedRelativeBonusPctFromSeedSlugs,
  calculateCappedSeedBoostPoints,
  isConfidentExternalTmdbMatch,
  normalizeBoostedScores,
  slugifyLetterboxdTitle,
} from '../src/lib/engine/recommendation-engine';
import {
  normalizeTitle as normalizeResolverTitle,
  parseTitleAndYear as parseResolverTitleAndYear,
  extractCanonicalSlugFromFilmUrl,
} from '../src/lib/utils/letterboxd-slug-resolver';
import { canonicalizeRecommendationUrls } from '../src/lib/utils/recommendation-url-canonicalizer';
import type { RecommendationResult } from '../src/types/recommendation';

declare const process: any;
declare const require: any;

const fs = require('fs');
const path = require('path');

type TestFn = () => void | Promise<void>;

const tests: Array<{ name: string; fn: TestFn }> = [];

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual, null, 2);
  const e = JSON.stringify(expected, null, 2);
  if (a !== e) {
    throw new Error(`${message}\nExpected: ${e}\nActual: ${a}`);
  }
}

test('url-utils: username extraction and film url helpers', () => {
  assertEqual(extractUsername('https://letterboxd.com/sean/films/'), 'sean', 'extractUsername should parse normal user urls');
  assertEqual(extractUsername('https://letterboxd.com/film/interstellar/'), null, 'extractUsername should reject reserved paths');
  assertEqual(isFilmPage('https://letterboxd.com/film/interstellar/'), true, 'isFilmPage should detect film pages');
  assertEqual(extractFilmSlug('https://letterboxd.com/film/interstellar/'), 'interstellar', 'extractFilmSlug should parse slug');
  assertEqual(letterboxdFilmUrl('in-the-mood-for-love'), 'https://letterboxd.com/film/in-the-mood-for-love/', 'letterboxdFilmUrl should format correctly');
  assertEqual(
    getProfilePageUrl('sean', 'films/ratings', 3),
    'https://letterboxd.com/sean/films/ratings/page/3/',
    'getProfilePageUrl should include pagination suffix for page > 1',
  );
});

test('pagination parser fixture snapshot', () => {
  const htmlPath = path.join(process.cwd(), 'tests', 'fixtures', 'letterboxd-profile-page.html');
  const expectedPath = path.join(process.cwd(), 'tests', 'fixtures', 'expected-films.json');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

  const actual = parseFilmsFromHTML(html);
  assertDeepEqual(actual, expected, 'parseFilmsFromHTML output should match expected fixture snapshot');
  assertEqual(parsePaginationFromHTML(html), 3, 'parsePaginationFromHTML should detect max page number');
});

test('recommendation engine: normalizeForComparison handles punctuation variants', () => {
  assertEqual(
    normalizeForComparison('Kiss Kiss (Bang Bang)'),
    normalizeForComparison('Kiss Kiss Bang Bang'),
    'normalizeForComparison should match punctuation variants',
  );
  assertEqual(
    normalizeForComparison('L.A. Confidential'),
    'l a confidential',
    'normalizeForComparison should normalize acronym punctuation',
  );
  assertEqual(
    slugifyLetterboxdTitle('Marketa Lazarová'),
    'marketa-lazarova',
    'slugifyLetterboxdTitle should transliterate accented characters',
  );
  assertEqual(
    slugifyLetterboxdTitle('Miller\'s Crossing'),
    'millers-crossing',
    'slugifyLetterboxdTitle should strip ASCII apostrophes',
  );
  assertEqual(
    slugifyLetterboxdTitle('Miller’s Crossing'),
    'millers-crossing',
    'slugifyLetterboxdTitle should strip curly apostrophes',
  );
  assertEqual(
    slugifyLetterboxdTitle('Porky\'s II: The Next Day'),
    'porkys-ii-the-next-day',
    'slugifyLetterboxdTitle should preserve words around apostrophes',
  );
  assertEqual(
    slugifyLetterboxdTitle('The Lighthouse'),
    'the-lighthouse',
    'slugifyLetterboxdTitle should keep existing plain-title behavior',
  );
});

test('recommendation engine: seed weights keep equal-score seeds at equal multipliers', () => {
  const seeds = [
    { slug: 'a', title: 'A', rating: 5, liked: true },
    { slug: 'b', title: 'B', rating: 5, liked: true },
    { slug: 'c', title: 'C', rating: 4.5, liked: false },
    { slug: 'd', title: 'D', rating: 3.5, liked: false },
  ] as any[];

  const weights = buildSeedWeightMap(seeds);
  assertEqual(weights.get('a'), weights.get('b'), 'seeds with same seed score should have same multiplier');
  if ((weights.get('a') ?? 1) <= (weights.get('c') ?? 1)) {
    throw new Error('top seed group should have higher weight than lower groups');
  }
  if ((weights.get('c') ?? 1) <= (weights.get('d') ?? 1)) {
    throw new Error('middle seed group should have higher weight than lowest group');
  }
});

test('recommendation engine: seed relative bonus percent averages seed-group bonuses', () => {
  const weights = new Map<string, number>([
    ['s20', 1.2],
    ['s15', 1.15],
    ['s05', 1.05],
  ]);
  const avg = calculateAverageSeedRelativeBonusPctFromSeedSlugs(['s20', 's15', 's05'], weights);
  const expected = (0.2 + 0.15 + 0.05) / 3;
  if (Math.abs(avg - expected) > 0.0001) {
    throw new Error(`expected avg bonus pct ${expected}, got ${avg}`);
  }
});

test('recommendation engine: seed boost points are capped at +10 and neutral when all weights are 1.0', () => {
  const neutralWeights = new Map<string, number>([
    ['s1', 1],
    ['s2', 1],
  ]);
  assertEqual(
    calculateCappedSeedBoostPoints(80, ['s1', 's2'], neutralWeights),
    0,
    'all-1.0 seed weights should produce zero seed-priority bonus',
  );

  const boostedWeights = new Map<string, number>([
    ['top', 1.2],
    ['mid', 1.1],
    ['low', 1],
  ]);
  const topOnlyBonus = calculateCappedSeedBoostPoints(90, ['top'], boostedWeights);
  if (topOnlyBonus > 10 || topOnlyBonus < 0) {
    throw new Error(`seed-priority bonus should stay within [0,10], got ${topOnlyBonus}`);
  }
  const mixedBonus = calculateCappedSeedBoostPoints(90, ['top', 'low'], boostedWeights);
  if (mixedBonus >= topOnlyBonus) {
    throw new Error('mixed top+low seeds should receive smaller bonus than top-only seeds');
  }
  assertEqual(
    calculateCappedSeedBoostPoints(200, ['top'], boostedWeights),
    10,
    'seed-priority bonus should cap at +10 points',
  );
  assertEqual(
    calculateCappedSeedBoostPoints(0, ['top'], boostedWeights),
    0,
    'seed-priority bonus should be zero when base score is 0',
  );
});

test('recommendation engine: conditional normalization scales only when max exceeds threshold', () => {
  const normalized = normalizeBoostedScores([125, 62.5, 25]);
  if (Math.abs(normalized[0] - 100) > 0.0001) {
    throw new Error(`expected highest normalized score to be 100, got ${normalized[0]}`);
  }
  // Ratios should stay proportional after normalization.
  const ratioOriginal = 62.5 / 125;
  const ratioNormalized = normalized[1] / normalized[0];
  if (Math.abs(ratioOriginal - ratioNormalized) > 0.0001) {
    throw new Error('normalization should preserve score proportions');
  }

  const unchanged = normalizeBoostedScores([105, 88, 72]);
  assertDeepEqual(
    unchanged,
    [105, 88, 72],
    'scores should remain unchanged when max boosted score does not exceed the normalization threshold',
  );
});

test('recommendation engine: external TMDb confidence matching is strict on year and title overlap', () => {
  const exact = isConfidentExternalTmdbMatch(
    'Kiss Kiss Bang Bang',
    2005,
    {
      id: 1,
      title: 'Kiss Kiss Bang Bang',
      release_date: '2005-10-21',
      overview: '',
      poster_path: null,
      backdrop_path: null,
      vote_average: 7.1,
      vote_count: 1000,
      genre_ids: [],
      popularity: 1,
    },
  );
  assertEqual(exact, true, 'exact title+year should be accepted');

  const wrongYear = isConfidentExternalTmdbMatch(
    'Kiss Kiss Bang Bang',
    2005,
    {
      id: 2,
      title: 'Kiss Kiss Bang Bang',
      release_date: '2001-03-01',
      overview: '',
      poster_path: null,
      backdrop_path: null,
      vote_average: 6.2,
      vote_count: 100,
      genre_ids: [],
      popularity: 1,
    },
  );
  assertEqual(wrongYear, false, 'same title but wrong year should be rejected when query year exists');

  const weakOverlap = isConfidentExternalTmdbMatch(
    'The Killer',
    undefined,
    {
      id: 3,
      title: 'Killer Klowns from Outer Space',
      release_date: '1988-05-27',
      overview: '',
      poster_path: null,
      backdrop_path: null,
      vote_average: 6.6,
      vote_count: 800,
      genre_ids: [],
      popularity: 1,
    },
  );
  assertEqual(weakOverlap, false, 'low-overlap title matches should be rejected');
});

test('letterboxd slug resolver: title and canonical slug helpers', () => {
  assertEqual(
    normalizeResolverTitle('Kiss Kiss (Bang Bang)'),
    'kiss kiss bang bang',
    'normalizeTitle should normalize punctuation variants',
  );
  assertEqual(
    normalizeResolverTitle('Marketa Lazarová'),
    'marketa lazarova',
    'normalizeTitle should currently strip accents consistently for matching',
  );
  const parsed = parseResolverTitleAndYear('L.A. Confidential (1997)');
  assertEqual(parsed.title, 'L.A. Confidential', 'parseTitleAndYear should preserve punctuation in title');
  assertEqual(parsed.year, 1997, 'parseTitleAndYear should extract year');
  assertEqual(
    extractCanonicalSlugFromFilmUrl('https://letterboxd.com/film/la-confidential/'),
    'la-confidential',
    'extractCanonicalSlugFromFilmUrl should parse canonical slug',
  );
});

test('recommendation canonicalization: updates changed slugs and tolerates resolver errors', async () => {
  const result: RecommendationResult = {
    username: 'tester',
    generatedAt: Date.now(),
    seedCount: 2,
    recommendations: [
      {
        tmdbId: 2019,
        title: 'The Lighthouse',
        year: 2019,
        overview: '',
        posterPath: null,
        tmdbRating: 7.5,
        genres: ['Drama'],
        score: 90,
        hits: [],
        onWatchlist: false,
        letterboxdUrl: 'https://letterboxd.com/film/the-lighthouse/',
      },
      {
        tmdbId: 117,
        title: 'Stalker',
        year: 1979,
        overview: '',
        posterPath: null,
        tmdbRating: 8.1,
        genres: ['Sci-Fi'],
        score: 88,
        hits: [],
        onWatchlist: false,
        letterboxdUrl: 'https://letterboxd.com/film/stalker/',
      },
      {
        tmdbId: 99999,
        title: 'Will Throw',
        year: 2000,
        overview: '',
        posterPath: null,
        tmdbRating: 5.1,
        genres: [],
        score: 40,
        hits: [],
        onWatchlist: false,
        letterboxdUrl: 'https://letterboxd.com/film/will-throw/',
      },
    ],
  };

  const { changed } = await canonicalizeRecommendationUrls(
    result,
    async (_rec, currentSlug) => {
      if (currentSlug === 'the-lighthouse') return 'the-lighthouse-2019';
      if (currentSlug === 'will-throw') throw new Error('resolver failure');
      return currentSlug;
    },
    2,
  );

  assertEqual(changed, true, 'canonicalizer should report changes when at least one slug is rewritten');
  assertEqual(
    result.recommendations[0].letterboxdUrl,
    'https://letterboxd.com/film/the-lighthouse-2019/',
    'canonicalizer should rewrite changed slugs',
  );
  assertEqual(
    result.recommendations[1].letterboxdUrl,
    'https://letterboxd.com/film/stalker/',
    'canonicalizer should keep unchanged slugs as-is',
  );
  assertEqual(
    result.recommendations[2].letterboxdUrl,
    'https://letterboxd.com/film/will-throw/',
    'canonicalizer should keep original slug if resolver throws',
  );
});

test('recommendation canonicalization: reports unchanged when no rewrites occur', async () => {
  const result: RecommendationResult = {
    username: 'tester',
    generatedAt: Date.now(),
    seedCount: 1,
    recommendations: [
      {
        tmdbId: 35,
        title: 'Cache',
        year: 2005,
        overview: '',
        posterPath: null,
        tmdbRating: 7.2,
        genres: [],
        score: 75,
        hits: [],
        onWatchlist: false,
        letterboxdUrl: 'https://letterboxd.com/film/cache/',
      },
    ],
  };

  const { changed } = await canonicalizeRecommendationUrls(result, async (_rec, currentSlug) => currentSlug);
  assertEqual(changed, false, 'canonicalizer should report unchanged when all slugs are already canonical');
});

async function runTests(): Promise<void> {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}`);
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  } else {
    console.log(`\n${tests.length} test(s) passed`);
  }
}

void runTests();
