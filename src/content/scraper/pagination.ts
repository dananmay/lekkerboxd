import type { ScrapedFilm } from '../../types/letterboxd';

/**
 * Parse films from raw HTML string (used by background service worker
 * which fetches paginated pages via HTTP).
 *
 * Real Letterboxd HTML structure (2026):
 *   <div class="react-component" data-component-class="LazyPoster"
 *        data-item-name="The Big Lebowski (1998)"
 *        data-item-slug="the-big-lebowski"
 *        data-film-id="51935"
 *        ...>
 *   followed by:
 *   <p class="poster-viewingdata" data-item-uid="film:51935">
 *     <span class="rating rated-8">★★★★</span>
 *   </p>
 */
export function parseFilmsFromHTML(html: string): ScrapedFilm[] {
  const films: ScrapedFilm[] = [];

  // Match react-component poster wrappers with data-item-slug
  const componentPattern = /data-component-class="LazyPoster"[^>]*?data-item-slug="([^"]+)"[^>]*/g;
  // Also try reversed attribute order
  const altPattern = /data-item-slug="([^"]+)"[^>]*?data-component-class="LazyPoster"/g;

  const allMatches: { slug: string; index: number; context: string }[] = [];

  for (const pattern of [componentPattern, altPattern]) {
    for (const match of html.matchAll(pattern)) {
      const slug = match[1];
      // Skip if we already found this slug
      if (allMatches.some(m => m.slug === slug)) continue;

      const pos = match.index!;
      // Grab surrounding context: 500 chars before, 2000 chars after
      const context = html.substring(
        Math.max(0, pos - 500),
        Math.min(html.length, pos + 2000),
      );

      allMatches.push({ slug, index: pos, context });
    }
  }

  for (const { slug, context } of allMatches) {
    // Extract title from data-item-name="Title (Year)"
    const nameMatch = context.match(/data-item-name="([^"]+)"/);
    const fullName = nameMatch ? decodeHTMLEntities(nameMatch[1]) : slug.replace(/-/g, ' ');

    const { title, year } = parseTitleAndYear(fullName);

    // Extract film ID
    const filmIdMatch = context.match(/data-film-id="(\d+)"/);
    const filmId = filmIdMatch ? filmIdMatch[1] : null;

    // Extract rating from poster-viewingdata sibling
    // Look for: rated-N class near this film's data
    let rating: number | null = null;
    if (filmId) {
      // Find the poster-viewingdata block for this film
      const viewingDataPattern = new RegExp(
        `poster-viewingdata[^>]*data-item-uid="film:${filmId}"[^>]*>([\\s\\S]*?)</p>`,
      );
      const viewingMatch = html.substring(
        Math.max(0, (allMatches.find(m => m.slug === slug)?.index ?? 0)),
        Math.min(html.length, (allMatches.find(m => m.slug === slug)?.index ?? 0) + 3000),
      ).match(viewingDataPattern);

      if (viewingMatch) {
        const ratedMatch = viewingMatch[1].match(/rated-(\d+)/);
        if (ratedMatch) {
          rating = parseInt(ratedMatch[1]) / 2;
        }
      }
    }

    // Fallback: check context for rating
    if (rating === null) {
      const contextRating = context.match(/rated-(\d+)/);
      if (contextRating) {
        rating = parseInt(contextRating[1]) / 2;
      }
    }

    // Check liked status
    const liked = context.includes('icon-liked');

    // Check reviewed status
    const reviewed = context.includes('icon-review') || context.includes('has-review');

    // Poster URL
    const posterMatch = context.match(
      /src="(https:\/\/a\.ltrbxd\.com\/resized\/film-poster[^"]*\.jpg[^"]*)"/,
    );
    const posterUrl = posterMatch ? posterMatch[1] : null;

    films.push({
      slug,
      title,
      year,
      rating,
      liked,
      reviewed,
      posterUrl,
      letterboxdUrl: `https://letterboxd.com/film/${slug}/`,
    });
  }

  return deduplicateFilms(films);
}

/**
 * Extract total page count from HTML.
 */
export function parsePaginationFromHTML(html: string): number {
  let maxPage = 1;

  const pagePattern = /\/page\/(\d+)\//g;
  for (const match of html.matchAll(pagePattern)) {
    const page = parseInt(match[1]);
    if (page > maxPage) maxPage = page;
  }

  return maxPage;
}

function parseTitleAndYear(nameWithYear: string): { title: string; year: number | null } {
  const match = nameWithYear.match(/^(.+?)\s*\((\d{4})\)\s*$/);
  if (match) {
    return { title: match[1].trim(), year: parseInt(match[2]) };
  }
  return { title: nameWithYear.trim(), year: null };
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function deduplicateFilms(films: ScrapedFilm[]): ScrapedFilm[] {
  const seen = new Set<string>();
  return films.filter(film => {
    if (seen.has(film.slug)) return false;
    seen.add(film.slug);
    return true;
  });
}
