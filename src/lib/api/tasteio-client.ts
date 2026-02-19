import { RateLimiter } from '../utils/rate-limiter';
import { fetchWithRetry } from '../utils/fetch-retry';

const rateLimiter = new RateLimiter(2, 2); // 2 req/sec for Taste.io
const TASTEIO_REQUEST_TIMEOUT_MS = 3500;

export interface TasteioRecommendation {
  title: string;
  year: number;
  slug: string;
}

async function tasteioFetch(url: string): Promise<string | null> {
  await rateLimiter.acquire();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TASTEIO_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Lekkerboxd/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    }, { deadlineMs: TASTEIO_REQUEST_TIMEOUT_MS });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Search Taste.io for a movie slug by title.
 */
async function resolveSlug(movieTitle: string): Promise<string | null> {
  await rateLimiter.acquire();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TASTEIO_REQUEST_TIMEOUT_MS);

  try {
    const query = encodeURIComponent(movieTitle);
    const response = await fetchWithRetry(`https://www.taste.io/api/movies/search?q=${query}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Lekkerboxd/1.0)',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    }, { deadlineMs: TASTEIO_REQUEST_TIMEOUT_MS });
    if (!response.ok) return null;

    const data = await response.json() as { movies?: { slug: string; name: string }[] };
    if (!data.movies?.length) return null;

    // Return the first match
    return data.movies[0].slug;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch similar movies from Taste.io's "Movies Like" page.
 * These pages contain JSON-LD structured data with recommendations.
 */
export async function getTasteioSimilar(movieTitle: string): Promise<TasteioRecommendation[]> {
  // First resolve the movie slug via search API
  const slug = await resolveSlug(movieTitle);
  if (!slug) return [];

  // Fetch the "movies like" page
  const html = await tasteioFetch(`https://www.taste.io/movies/like/${slug}`);
  if (!html) return [];

  return parseRecommendations(html);
}

/**
 * Parse recommendations from Taste.io HTML.
 * Tries JSON-LD first, falls back to HTML parsing.
 */
function parseRecommendations(html: string): TasteioRecommendation[] {
  const recs: TasteioRecommendation[] = [];

  // Try JSON-LD structured data first
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const jsonLd = JSON.parse(jsonLdMatch[1]);
      const items = jsonLd.itemListElement ?? jsonLd;
      if (Array.isArray(items)) {
        for (const item of items) {
          const movie = item.item ?? item;
          if (movie?.name) {
            const year = extractYear(movie.datePublished ?? movie.dateCreated ?? '');
            recs.push({
              title: movie.name,
              year,
              slug: movie.url?.split('/').filter(Boolean).pop() ?? '',
            });
          }
        }
      }
    } catch {
      // JSON-LD parse failed, fall through to HTML parsing
    }
  }

  if (recs.length > 0) return recs;

  // Fallback: parse movie cards from HTML
  // Taste.io movie cards typically have titles in links like /movies/slug
  const cardPattern = /<a[^>]*href="\/movies\/([^/"]+)"[^>]*>[\s\S]*?<[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)/gi;
  let match;
  while ((match = cardPattern.exec(html)) !== null) {
    const slug = match[1];
    const title = decodeHtmlEntities(match[2].trim());
    if (title && slug && slug !== 'like') {
      recs.push({ title, year: 0, slug });
    }
  }

  return recs;
}

function extractYear(dateStr: string): number {
  const match = dateStr.match(/(\d{4})/);
  return match ? parseInt(match[1]) : 0;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'");
}
