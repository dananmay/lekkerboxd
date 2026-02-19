import type { ScrapedFilm } from '../../types/letterboxd';

/**
 * Parse film entries from a Letterboxd page DOM.
 * Works on /films/, /likes/films/, /films/ratings/, and /watchlist/ pages.
 *
 * Real Letterboxd DOM structure (as of 2026):
 *   <div class="react-component" data-component-class="LazyPoster"
 *        data-item-name="The Big Lebowski (1998)"
 *        data-item-slug="the-big-lebowski"
 *        data-item-link="/film/the-big-lebowski/"
 *        data-film-id="51935"
 *        ...>
 *     <div class="poster film-poster" data-watched="true" data-in-watchlist="false">
 *       <img src="..." alt="Poster for The Big Lebowski (1998)" />
 *       ...
 *     </div>
 *   </div>
 *   <p class="poster-viewingdata" data-item-uid="film:51935">
 *     <span class="rating rated-8">★★★★</span>
 *     <span class="icon-liked">...</span>
 *   </p>
 */
export function parseFilmsFromDOM(doc: Document | HTMLElement): ScrapedFilm[] {
  const films: ScrapedFilm[] = [];

  // Primary selector: the react-component wrappers with data-item-slug
  const posterWrappers = doc.querySelectorAll(
    '.react-component[data-item-slug], [data-component-class="LazyPoster"]'
  );

  for (const wrapper of posterWrappers) {
    const film = parseReactPosterElement(wrapper as HTMLElement, doc);
    if (film) films.push(film);
  }

  // Fallback: try older-style li-based poster lists if react components not found
  if (films.length === 0) {
    const listItems = doc.querySelectorAll('.poster-list li, .film-list li');
    for (const li of listItems) {
      const film = parseLegacyListItem(li as HTMLElement);
      if (film) films.push(film);
    }
  }

  return films;
}

function parseReactPosterElement(wrapper: HTMLElement, doc: Document | HTMLElement): ScrapedFilm | null {
  const slug = wrapper.getAttribute('data-item-slug');
  if (!slug) return null;

  // Title + year from data-item-name (e.g. "The Big Lebowski (1998)")
  const itemName = wrapper.getAttribute('data-item-name') || '';
  const fullDisplayName = wrapper.getAttribute('data-item-full-display-name') || itemName;
  const { title, year } = parseTitleAndYear(fullDisplayName || slug.replace(/-/g, ' '));

  // Film ID
  const filmId = wrapper.getAttribute('data-film-id') || '';

  // Poster div has watched/watchlist status
  const posterDiv = wrapper.querySelector('.poster, .film-poster');
  const watched = posterDiv?.getAttribute('data-watched') === 'true';
  const inWatchlist = posterDiv?.getAttribute('data-in-watchlist') === 'true';

  // Poster image
  const img = wrapper.querySelector('img');
  const posterUrl = img?.getAttribute('src') || null;

  // Rating and liked status come from the SIBLING .poster-viewingdata element
  // It's a <p> right after the react-component div, matched by data-item-uid
  const viewingData = findViewingData(wrapper, filmId, doc);
  const rating = parseRatingFromViewingData(viewingData);
  const liked = parseLikedFromViewingData(viewingData);
  const reviewed = parseReviewedFromViewingData(viewingData);

  return {
    slug,
    title,
    year,
    rating,
    liked,
    reviewed,
    posterUrl,
    letterboxdUrl: `https://letterboxd.com/film/${slug}/`,
  };
}

/**
 * Find the .poster-viewingdata sibling for a film.
 * It's typically the next sibling element with data-item-uid="film:{filmId}"
 */
function findViewingData(
  wrapper: HTMLElement,
  filmId: string,
  doc: Document | HTMLElement,
): HTMLElement | null {
  // Try next sibling first (most common layout)
  let sibling = wrapper.nextElementSibling;
  if (sibling?.classList.contains('poster-viewingdata')) {
    return sibling as HTMLElement;
  }

  // Try querying by data-item-uid
  if (filmId) {
    const el = doc.querySelector(
      `.poster-viewingdata[data-item-uid="film:${filmId}"]`
    );
    if (el) return el as HTMLElement;
  }

  return null;
}

function parseRatingFromViewingData(el: HTMLElement | null): number | null {
  if (!el) return null;

  // Look for <span class="rating rated-8"> where 8 = 4 stars (half-star units)
  const ratingSpan = el.querySelector('.rating, [class*="rated-"]');
  if (!ratingSpan) return null;

  const classList = ratingSpan.className;
  const ratedMatch = classList.match(/rated-(\d+)/);
  if (ratedMatch) {
    return parseInt(ratedMatch[1]) / 2;
  }

  // Fallback: count star characters
  const text = ratingSpan.textContent || '';
  const fullStars = (text.match(/★/g) || []).length;
  const halfStars = (text.match(/½/g) || []).length;
  if (fullStars > 0 || halfStars > 0) {
    return fullStars + halfStars * 0.5;
  }

  return null;
}

function parseLikedFromViewingData(el: HTMLElement | null): boolean {
  if (!el) return false;
  return el.querySelector('.icon-liked, .like-link-target .icon-liked') !== null;
}

function parseReviewedFromViewingData(el: HTMLElement | null): boolean {
  if (!el) return false;
  return el.querySelector('.icon-review, .has-review') !== null;
}

function parseTitleAndYear(nameWithYear: string): { title: string; year: number | null } {
  // Match "Title (YYYY)" pattern
  const match = nameWithYear.match(/^(.+?)\s*\((\d{4})\)\s*$/);
  if (match) {
    return { title: match[1].trim(), year: parseInt(match[2]) };
  }
  return { title: nameWithYear.trim(), year: null };
}

/**
 * Fallback parser for older-style list items (li-based poster lists)
 */
function parseLegacyListItem(li: HTMLElement): ScrapedFilm | null {
  const posterDiv = li.querySelector('[data-film-slug], [data-item-slug]');
  if (!posterDiv) return null;

  const slug = posterDiv.getAttribute('data-film-slug')
    || posterDiv.getAttribute('data-item-slug');
  if (!slug) return null;

  const img = li.querySelector('img');
  const alt = img?.getAttribute('alt') || '';
  const { title, year } = parseTitleAndYear(alt || slug.replace(/-/g, ' '));

  const ratingEl = li.querySelector('[class*="rated-"]');
  let rating: number | null = null;
  if (ratingEl) {
    const m = ratingEl.className.match(/rated-(\d+)/);
    if (m) rating = parseInt(m[1]) / 2;
  }

  return {
    slug,
    title,
    year,
    rating,
    liked: li.querySelector('.icon-liked') !== null,
    reviewed: li.querySelector('.icon-review') !== null,
    posterUrl: img?.getAttribute('src') || null,
    letterboxdUrl: `https://letterboxd.com/film/${slug}/`,
  };
}

/**
 * Extract pagination info from a Letterboxd page.
 */
export function parsePagination(doc: Document | HTMLElement): number {
  const paginateItems = doc.querySelectorAll('.paginate-pages li a, .pagination a');
  let maxPage = 1;

  for (const item of paginateItems) {
    const text = item.textContent?.trim();
    if (text && /^\d+$/.test(text)) {
      const page = parseInt(text);
      if (page > maxPage) maxPage = page;
    }

    const href = item.getAttribute('href') || '';
    const pageMatch = href.match(/\/page\/(\d+)\//);
    if (pageMatch) {
      const page = parseInt(pageMatch[1]);
      if (page > maxPage) maxPage = page;
    }
  }

  return maxPage;
}

/**
 * Detect what section of a Letterboxd profile we're on.
 */
export function detectPageType(url: string): 'films' | 'likes' | 'ratings' | 'watchlist' | null {
  if (/\/likes\/films/.test(url)) return 'likes';
  if (/\/films\/ratings/.test(url)) return 'ratings';
  if (/\/watchlist/.test(url)) return 'watchlist';
  if (/\/[a-zA-Z0-9_]+\/films\/?(\?|$)/.test(url)) return 'films';
  return null;
}
