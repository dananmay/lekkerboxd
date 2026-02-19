import { RateLimiter } from '../utils/rate-limiter';
import { fetchWithRetry } from '../utils/fetch-retry';

const rateLimiter = new RateLimiter(2, 2); // 2 req/sec for Reddit
const REDDIT_REQUEST_TIMEOUT_MS = 3500;

interface RedditPost {
  title: string;
  selftext: string;
  score: number;
  num_comments: number;
  permalink: string;
}

interface RedditComment {
  body: string;
  score: number;
}

export interface RedditRecommendation {
  movieTitle: string;
  postScore: number;
  commentScore: number;
  source: string;
}

async function redditFetch<T>(url: string): Promise<T | null> {
  await rateLimiter.acquire();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REDDIT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'LetterboxdRecs/1.0' },
      signal: controller.signal,
    }, { deadlineMs: REDDIT_REQUEST_TIMEOUT_MS });
    if (!response.ok) return null;
    return response.json() as Promise<T>;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const SUBREDDITS = ['ifyoulikeblank', 'MovieSuggestions', 'flicks', 'TrueFilm', 'criterion'];

export async function searchRedditForMovieRecs(movieTitle: string): Promise<RedditRecommendation[]> {
  const allRecs: RedditRecommendation[] = [];
  const results = await Promise.allSettled(SUBREDDITS.map(subreddit => searchSubreddit(subreddit, movieTitle)));
  for (const result of results) {
    if (result.status === 'fulfilled') allRecs.push(...result.value);
  }

  return deduplicateRedditRecs(allRecs);
}

// Keep old name as alias for backwards compatibility
export const searchIfYouLikeBlank = searchRedditForMovieRecs;

async function searchSubreddit(subreddit: string, movieTitle: string): Promise<RedditRecommendation[]> {
  const query = encodeURIComponent(`"${movieTitle}" movie`);
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${query}&restrict_sr=1&sort=relevance&limit=3`;

  const data = await redditFetch<{ data: { children: { data: RedditPost }[] } }>(url);
  if (!data?.data?.children?.length) return [];

  const recommendations: RedditRecommendation[] = [];

  for (const { data: post } of data.data.children) {
    const titles = extractMovieTitles(post.selftext + ' ' + post.title);
    for (const title of titles) {
      if (title.toLowerCase() === movieTitle.toLowerCase()) continue;
      recommendations.push({
        movieTitle: title,
        postScore: post.score,
        commentScore: 0,
        source: `reddit.com${post.permalink}`,
      });
    }
  }

  return recommendations;
}

function extractMovieTitles(text: string): string[] {
  const titles: string[] = [];

  // Match quoted titles: "Movie Title" or 'Movie Title'
  const quotedMatches = text.matchAll(/["']([A-Z][^"']{1,60})["']/g);
  for (const match of quotedMatches) {
    titles.push(match[1].trim());
  }

  // Match bold/italic markdown titles: **Movie Title** or *Movie Title*
  const mdMatches = text.matchAll(/\*\*([^*]{2,60})\*\*|\*([^*]{2,60})\*/g);
  for (const match of mdMatches) {
    const title = (match[1] || match[2]).trim();
    if (title.length > 2 && /^[A-Z]/.test(title)) {
      titles.push(title);
    }
  }

  // Match "I recommend X" or "check out X" patterns
  const recPatterns = text.matchAll(
    /(?:recommend|check out|watch|try|loved?|enjoy(?:ed)?)\s+([A-Z][A-Za-z0-9\s:'-]{2,40}?)(?:\.|,|!|\?|\n|$)/g,
  );
  for (const match of recPatterns) {
    const title = match[1].trim();
    // Filter out common false positives
    if (!isCommonPhrase(title) && title.length > 2) {
      titles.push(title);
    }
  }

  return [...new Set(titles)];
}

function isCommonPhrase(text: string): boolean {
  const phrases = [
    'it', 'this', 'that', 'the', 'these', 'those', 'something', 'anything',
    'everything', 'nothing', 'some of', 'all of', 'one of', 'any of',
    'movies like', 'films like', 'shows like',
  ];
  return phrases.includes(text.toLowerCase());
}

function deduplicateRedditRecs(recs: RedditRecommendation[]): RedditRecommendation[] {
  const map = new Map<string, RedditRecommendation>();
  for (const rec of recs) {
    const key = rec.movieTitle.toLowerCase();
    const existing = map.get(key);
    if (!existing || rec.postScore + rec.commentScore > existing.postScore + existing.commentScore) {
      map.set(key, rec);
    }
  }
  return Array.from(map.values());
}
