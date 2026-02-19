export function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

export function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTitleAndYear(nameWithYear: string): { title: string; year: number | null } {
  const decoded = decodeHTMLEntities(nameWithYear);
  const match = decoded.match(/^(.+?)\s*\((\d{4})\)\s*$/);
  if (match) {
    return { title: match[1].trim(), year: parseInt(match[2]) };
  }
  return { title: decoded.trim(), year: null };
}

export function extractCanonicalSlugFromFilmUrl(url: string): string | null {
  const match = url.match(/letterboxd\.com\/film\/([^/]+)\/?/);
  return match ? match[1] : null;
}

function extractSearchCandidates(html: string): Array<{ slug: string; title: string; year: number | null }> {
  const candidates: Array<{ slug: string; title: string; year: number | null }> = [];
  const tagPattern = /<[^>]*data-item-slug="([^"]+)"[^>]*>/gi;

  for (const match of html.matchAll(tagPattern)) {
    const tag = match[0];
    const slug = match[1];
    const nameMatch = tag.match(/data-item-name="([^"]+)"/i);
    if (!slug || !nameMatch?.[1]) continue;
    const parsed = parseTitleAndYear(nameMatch[1]);
    candidates.push({ slug, title: parsed.title, year: parsed.year });
  }

  return candidates;
}

export async function resolveCanonicalFilmSlug(
  filmSlug: string,
  filmTitle?: string,
  filmYear?: number,
): Promise<string> {
  // First, try direct film page. If Letterboxd redirects, use the canonical slug.
  try {
    const direct = await fetch(`https://letterboxd.com/film/${filmSlug}/`, {
      redirect: 'follow',
    });
    if (direct.ok) {
      const canonicalFromUrl = extractCanonicalSlugFromFilmUrl(direct.url);
      if (canonicalFromUrl) {
        // If title/year context is provided, verify the landing page broadly matches.
        if (filmTitle || filmYear) {
          const html = await direct.text();
          const titleMatch = html.match(/property="og:title"\s+content="([^"]+)"/i);
          const pageMeta = parseTitleAndYear(titleMatch?.[1] ?? '');
          const sameTitle = !filmTitle || normalizeTitle(pageMeta.title) === normalizeTitle(filmTitle);
          const sameYear = !filmYear || pageMeta.year === filmYear;
          if (sameTitle && sameYear) {
            return canonicalFromUrl;
          }
        } else {
          return canonicalFromUrl;
        }
      }
    }
  } catch {
    // Fall through to search fallback.
  }

  // Fallback: search Letterboxd and pick the best title/year match.
  const query = (filmTitle && filmTitle.trim().length > 0)
    ? filmTitle
    : filmSlug.replace(/-/g, ' ');
  try {
    const searchUrl = `https://letterboxd.com/search/films/${encodeURIComponent(query)}/`;
    const response = await fetch(searchUrl);
    if (!response.ok) return filmSlug;

    const html = await response.text();
    const candidates = extractSearchCandidates(html);
    if (candidates.length === 0) return filmSlug;

    let best = candidates[0];
    let bestScore = -1;
    for (const candidate of candidates) {
      let score = 0;
      if (filmTitle && normalizeTitle(candidate.title) === normalizeTitle(filmTitle)) score += 3;
      if (filmYear && candidate.year === filmYear) score += 2;
      if (candidate.slug === filmSlug) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best.slug;
  } catch {
    return filmSlug;
  }
}
