# TMDb Proxy (Cloudflare Worker)

This Worker proxies a narrow TMDb API surface used by Lekkerboxd:

- `GET /v1/tmdb/search/movie`
- `GET /v1/tmdb/movie/:id`

It provides:
- Server-side TMDb key storage (`TMDB_API_KEY` secret)
- Edge caching (search and movie-detail TTLs)
- In-flight request deduplication
- Optional strict origin allowlisting (`ALLOWED_ORIGIN`)

## Setup

1. Install Wrangler and login:
- `npm install -g wrangler`
- `wrangler login`

2. Set secret:
- `wrangler secret put TMDB_API_KEY`

3. Optional vars:
- `wrangler secret put ALLOWED_ORIGIN`
- `wrangler secret put CACHE_TTL_SEARCH_SECONDS`
- `wrangler secret put CACHE_TTL_MOVIE_SECONDS`

4. Deploy:
- `wrangler deploy`

## Extension integration

In the extension Settings page, set `TMDb proxy URL` to:
- `https://<worker-name>.<subdomain>.workers.dev`

If you use a custom domain, add that domain to extension `host_permissions`.
