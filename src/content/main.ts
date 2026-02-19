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

  // Inject styles
  shadow.innerHTML = `
    <style>
      :host {
        display: block;
        margin: 20px 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .lb-rec-container {
        background: #14181c;
        border: 1px solid #2c3440;
        border-radius: 8px;
        padding: 16px;
        color: #9ab;
      }
      .lb-rec-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .lb-rec-title {
        font-size: 14px;
        font-weight: 600;
        color: #def;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      .lb-rec-close {
        background: none;
        border: none;
        color: #678;
        cursor: pointer;
        font-size: 18px;
        padding: 4px 8px;
      }
      .lb-rec-close:hover { color: #def; }
      .lb-rec-grid {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding-bottom: 8px;
      }
      .lb-rec-card {
        flex: 0 0 auto;
        width: 105px;
        text-decoration: none;
        color: inherit;
        transition: transform 0.15s;
      }
      .lb-rec-card:hover { transform: translateY(-2px); }
      .lb-rec-poster {
        width: 105px;
        height: 158px;
        border-radius: 4px;
        background: #1a2030;
        object-fit: cover;
      }
      .lb-rec-film-title {
        font-size: 11px;
        color: #def;
        margin-top: 4px;
        line-height: 1.3;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .lb-rec-film-year {
        font-size: 10px;
        color: #678;
      }
      .lb-rec-score {
        display: inline-block;
        font-size: 9px;
        background: #00c030;
        color: #fff;
        padding: 1px 4px;
        border-radius: 3px;
        margin-top: 2px;
      }
      .lb-rec-watchlist-badge {
        display: inline-block;
        font-size: 9px;
        background: #40bcf4;
        color: #fff;
        padding: 1px 4px;
        border-radius: 3px;
        margin-left: 4px;
      }
      .lb-rec-because {
        font-size: 9px;
        color: #678;
        margin-top: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
    <div class="lb-rec-container">
      <div class="lb-rec-header">
        <span class="lb-rec-title">Recommended For You</span>
        <button class="lb-rec-close" title="Dismiss">&times;</button>
      </div>
      <div class="lb-rec-grid">
        ${recommendations.map(rec => `
          <a class="lb-rec-card" href="${rec.letterboxdUrl}" title="${escapeHtml(rec.title)} (${rec.year})&#10;Score: ${rec.score}/100&#10;Because you liked: ${rec.hits.map(h => h.seedFilmTitle).slice(0, 3).join(', ')}">
            <img class="lb-rec-poster"
              src="${rec.posterPath ? `https://image.tmdb.org/t/p/w185${rec.posterPath}` : ''}"
              alt="${escapeHtml(rec.title)}"
              loading="lazy" />
            <div class="lb-rec-film-title">${escapeHtml(rec.title)}</div>
            <div class="lb-rec-film-year">${rec.year || ''}</div>
            <span class="lb-rec-score">${rec.score}</span>
            ${rec.onWatchlist ? '<span class="lb-rec-watchlist-badge">Watchlist</span>' : ''}
            <div class="lb-rec-because">Because: ${rec.hits.map(h => h.seedFilmTitle).slice(0, 2).join(', ')}</div>
          </a>
        `).join('')}
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
    img.addEventListener('error', () => { img.style.display = 'none'; });
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
