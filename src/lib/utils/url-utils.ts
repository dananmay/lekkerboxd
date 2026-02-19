/**
 * Detect the currently logged-in Letterboxd user from the page DOM.
 * Looks for the "Films" link in the nav bar which has href="/username/films/".
 */
export function detectLoggedInUser(doc: Document): string | null {
  // Primary: nav subnav link to user's films page
  const filmsLink = doc.querySelector('.main-nav .subnav a[href$="/films/"]');
  if (filmsLink) {
    const href = filmsLink.getAttribute('href');
    const match = href?.match(/^\/([^/]+)\/films\/$/);
    if (match) return match[1];
  }

  // Fallback: look for avatar element with user info
  const avatarEl = doc.querySelector('[data-js-user-avatar]');
  if (avatarEl) {
    // Walk up to find the parent <a> and check siblings/nearby links
    const parentLink = avatarEl.closest('a');
    if (parentLink) {
      // Try to find a nearby subnav with profile links
      const nav = parentLink.closest('nav, .main-nav, .primary-nav');
      if (nav) {
        const profileLink = nav.querySelector('a[href$="/films/"]');
        if (profileLink) {
          const href = profileLink.getAttribute('href');
          const match = href?.match(/^\/([^/]+)\/films\/$/);
          if (match) return match[1];
        }
      }
    }
  }

  return null;
}

export function extractUsername(url: string): string | null {
  const match = url.match(/letterboxd\.com\/([a-zA-Z0-9_]+)/);
  if (!match) return null;

  const username = match[1];
  // Exclude known non-user paths
  const reserved = [
    'film', 'films', 'list', 'lists', 'actor', 'director', 'search',
    'settings', 'about', 'pro', 'patron', 'contact', 'legal', 'terms',
    'privacy', 'activity', 'members', 'journal', 'year', 'crew',
  ];
  if (reserved.includes(username.toLowerCase())) return null;
  return username;
}

export function isProfilePage(url: string): boolean {
  return extractUsername(url) !== null;
}

export function isFilmPage(url: string): boolean {
  return /letterboxd\.com\/film\/[a-z0-9-]+\/?$/.test(url);
}

export function extractFilmSlug(url: string): string | null {
  const match = url.match(/letterboxd\.com\/film\/([a-z0-9-]+)/);
  return match ? match[1] : null;
}

export function letterboxdFilmUrl(slug: string): string {
  return `https://letterboxd.com/film/${slug}/`;
}

export function tmdbPosterUrl(posterPath: string | null, size = 'w342'): string {
  if (!posterPath) return '';
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}

export function getProfilePageUrl(
  username: string,
  section: 'films' | 'likes/films' | 'films/ratings' | 'watchlist',
  page = 1,
): string {
  const base = `https://letterboxd.com/${username}/${section}/`;
  return page > 1 ? `${base}page/${page}/` : base;
}
