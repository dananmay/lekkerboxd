import { parseFilmsFromDOM, parsePagination, detectPageType } from './scraper/letterboxd-parser';
import { extractUsername, isFilmPage, extractFilmSlug, detectLoggedInUser } from '../lib/utils/url-utils';
import type { ScrapedPageMessage, GetFilmRecommendationsMessage, LoggedInUserMessage } from '../types/messages';
import type { Recommendation } from '../types/recommendation';

// Scrape current page if it's a profile section
function scrapeCurrentPage(): void {
  const url = window.location.href;
  const username = extractUsername(url);
  const pageType = detectPageType(url);

  if (!username || !pageType) return;

  const films = parseFilmsFromDOM(document);
  const totalPages = parsePagination(document);

  // Determine current page number
  const pageMatch = url.match(/\/page\/(\d+)/);
  const currentPage = pageMatch ? parseInt(pageMatch[1]) : 1;

  console.log(`[LB Recs] Scraped ${films.length} films from ${username}/${pageType} (page ${currentPage}/${totalPages})`);

  if (films.length > 0) {
    const message: ScrapedPageMessage = {
      type: 'SCRAPED_PAGE',
      username,
      films,
      pageType,
      page: currentPage,
      totalPages,
    };
    void chrome.runtime.sendMessage(message).catch(() => {});
  }
}

// Inject recommendations overlay on film pages
function injectOverlay(recommendations: Recommendation[]): void {
  // Remove existing overlay if present
  const existing = document.getElementById('lb-rec-overlay-root');
  if (existing) existing.remove();

  if (recommendations.length === 0) return;

  // Create shadow DOM container
  const host = document.createElement('div');
  host.id = 'lb-rec-overlay-root';
  const shadow = host.attachShadow({ mode: 'open' });

  const cardsMarkup = recommendations.map(rec => {
    const yearText = rec.year ? String(rec.year) : 'Unknown year';
    const because = rec.hits.map(h => h.seedFilmTitle).slice(0, 2).join(', ');
    const posterMarkup = rec.posterPath
      ? `<img class="lb-rec-poster"
          src="https://image.tmdb.org/t/p/w185${rec.posterPath}"
          alt="${escapeHtml(rec.title)}"
          loading="lazy" />`
      : '<div class="lb-rec-poster lb-rec-poster-empty">No poster</div>';

    return `
      <a class="lb-rec-card" href="${rec.letterboxdUrl}" title="${escapeHtml(rec.title)} (${yearText})&#10;Score: ${rec.score}/100&#10;Because: ${because}">
        ${posterMarkup}
        <div class="lb-rec-film-title">${escapeHtml(rec.title)}</div>
        <div class="lb-rec-meta-row">
          <div class="lb-rec-film-year">${escapeHtml(yearText)}</div>
          <span class="lb-rec-score">${rec.score}</span>
        </div>
        ${rec.onWatchlist ? '<span class="lb-rec-watchlist-badge">In Watchlist</span>' : ''}
        ${because ? `<div class="lb-rec-because">Because you liked ${escapeHtml(because)}</div>` : ''}
      </a>
    `;
  }).join('');

  // Inject styles
  shadow.innerHTML = `
    <style>
      :host {
        display: block;
        margin: 18px 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .lb-rec-container {
        background: #14181c;
        border: 1px solid #2d3745;
        border-radius: 10px;
        padding: 14px;
        color: #9ab;
      }
      .lb-rec-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
        gap: 10px;
      }
      .lb-rec-title {
        font-size: 13px;
        font-weight: 600;
        color: #def;
        text-transform: uppercase;
        letter-spacing: 0.9px;
      }
      .lb-rec-subtitle {
        font-size: 10px;
        color: #7f91a7;
        margin-bottom: 10px;
      }
      .lb-rec-close {
        background: none;
        border: none;
        color: #678;
        cursor: pointer;
        font-size: 17px;
        padding: 2px 6px;
        line-height: 1;
        border-radius: 6px;
      }
      .lb-rec-close:hover {
        color: #def;
        background: rgba(255, 255, 255, 0.08);
      }
      .lb-rec-grid {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        padding-bottom: 8px;
      }
      .lb-rec-card {
        flex: 0 0 auto;
        width: 122px;
        background: #1a222e;
        border: 1px solid #2e3c4c;
        border-radius: 8px;
        padding: 7px;
        text-decoration: none;
        color: inherit;
        transition: transform 0.15s, border-color 0.15s;
      }
      .lb-rec-card:hover {
        transform: translateY(-2px);
        border-color: #46607b;
      }
      .lb-rec-poster {
        width: 108px;
        height: 162px;
        border-radius: 6px;
        background: #1a2030;
        object-fit: cover;
        display: block;
      }
      .lb-rec-poster-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        color: #6f8095;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.7px;
        border: 1px dashed #324559;
      }
      .lb-rec-film-title {
        font-size: 11px;
        color: #def;
        margin-top: 6px;
        line-height: 1.25;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        min-height: 28px;
      }
      .lb-rec-meta-row {
        margin-top: 4px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      .lb-rec-film-year {
        font-size: 10px;
        color: #678;
      }
      .lb-rec-score {
        display: inline-block;
        font-size: 10px;
        background: #0ab65a;
        color: #fff;
        padding: 1px 7px;
        border-radius: 999px;
        font-weight: 600;
      }
      .lb-rec-watchlist-badge {
        display: inline-block;
        font-size: 9px;
        background: #2f9bcc;
        color: #fff;
        padding: 2px 6px;
        border-radius: 999px;
        margin-top: 4px;
      }
      .lb-rec-because {
        font-size: 10px;
        color: #8ea0b7;
        margin-top: 4px;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .lb-rec-grid::-webkit-scrollbar { height: 8px; }
      .lb-rec-grid::-webkit-scrollbar-track {
        background: #1a222f;
        border-radius: 999px;
      }
      .lb-rec-grid::-webkit-scrollbar-thumb {
        background: #304256;
        border-radius: 999px;
      }
    </style>
    <div class="lb-rec-container">
      <div class="lb-rec-header">
        <span class="lb-rec-title">Recommended For This Film</span>
        <button class="lb-rec-close" title="Dismiss" aria-label="Dismiss recommendations">&times;</button>
      </div>
      <div class="lb-rec-subtitle">${recommendations.length} picks from your taste profile</div>
      <div class="lb-rec-grid">
        ${cardsMarkup}
      </div>
    </div>
  `;

  // Insert after the main content section
  const insertTarget =
    document.querySelector('.film-detail-content') ||
    document.querySelector('#content') ||
    document.querySelector('main') ||
    document.body;

  if (insertTarget && insertTarget !== document.body) {
    insertTarget.parentNode?.insertBefore(host, insertTarget.nextSibling);
  } else {
    document.body.appendChild(host);
  }

  // Hide broken poster images programmatically (avoids inline onerror blocked by CSP)
  shadow.querySelectorAll<HTMLImageElement>('.lb-rec-poster').forEach(img => {
    img.addEventListener('error', () => {
      const fallback = document.createElement('div');
      fallback.className = 'lb-rec-poster lb-rec-poster-empty';
      fallback.textContent = 'No poster';
      img.replaceWith(fallback);
    });
  });

  // Close button handler
  shadow.querySelector('.lb-rec-close')?.addEventListener('click', () => {
    host.remove();
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'RECOMMENDATIONS_READY') {
    injectOverlay(message.result.recommendations);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'REQUEST_SCRAPE') {
    scrapeCurrentPage();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// Auto-detect logged-in user and save to settings
const loggedInUser = detectLoggedInUser(document);
if (loggedInUser) {
  console.log(`[LB Recs] Detected logged-in user: ${loggedInUser}`);
  const userMessage: LoggedInUserMessage = {
    type: 'LOGGED_IN_USER',
    username: loggedInUser,
  };
  void chrome.runtime.sendMessage(userMessage).catch(() => {});
}

// Auto-scrape on page load
scrapeCurrentPage();

// Request film-specific recommendations on film pages
if (isFilmPage(window.location.href)) {
  const slug = extractFilmSlug(window.location.href);
  if (slug) {
    // Extract film title from page
    const titleEl = document.querySelector('.headline-1, h1.filmtitle, [itemprop="name"]');
    const yearEl = document.querySelector('.releaseyear a, .year');
    const title = titleEl?.textContent?.trim() || slug.replace(/-/g, ' ');
    const year = yearEl ? parseInt(yearEl.textContent || '') : null;

    const message: GetFilmRecommendationsMessage = {
      type: 'GET_FILM_RECOMMENDATIONS',
      filmSlug: slug,
      filmTitle: title,
      filmYear: year,
    };
    void chrome.runtime.sendMessage(message).catch(() => {});
  }
}
