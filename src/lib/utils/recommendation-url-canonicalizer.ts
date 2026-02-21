import type { Recommendation, RecommendationResult } from '../../types/recommendation';
import { letterboxdFilmUrl } from './url-utils';

export function extractFilmSlugFromRecommendationUrl(url: string): string | null {
  const match = url.match(/\/film\/([^/]+)\/?/);
  return match?.[1] ?? null;
}

async function runBoundedConcurrency<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number,
): Promise<void> {
  const safeConcurrency = Math.max(1, Math.min(items.length, concurrency));
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, () => runWorker()));
}

export async function canonicalizeRecommendationUrls(
  result: RecommendationResult,
  resolveCanonicalSlug: (rec: Recommendation, currentSlug: string) => Promise<string>,
  concurrency = 4,
): Promise<{ changed: boolean }> {
  let changed = false;

  await runBoundedConcurrency(result.recommendations, async (rec) => {
    const currentSlug = extractFilmSlugFromRecommendationUrl(rec.letterboxdUrl);
    if (!currentSlug) return;

    try {
      const canonicalSlug = await resolveCanonicalSlug(rec, currentSlug);
      if (canonicalSlug && canonicalSlug !== currentSlug) {
        rec.letterboxdUrl = letterboxdFilmUrl(canonicalSlug);
        changed = true;
      }
    } catch {
      // Keep original URL if canonical resolution fails for this recommendation.
    }
  }, concurrency);

  return { changed };
}
