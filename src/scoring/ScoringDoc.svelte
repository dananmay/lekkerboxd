<script lang="ts">
  import tmdbLogoLong from '../../static/tmdb-logo-long.svg';
</script>

<div class="doc">
  <!-- Header -->
  <header class="doc-header">
    <div class="brand">
      <span class="logo-dot"></span>
      <span class="logo-text">Lekkerboxd</span>
    </div>
    <h1>How Lekkerboxd Works</h1>
    <p class="subtitle">A look under the hood at how Lekkerboxd finds and manages films you'll love</p>
  </header>

  <!-- Table of Contents -->
  <nav class="toc">
    <h2 class="toc-title">Contents</h2>
    <ol class="toc-list">
      <li><a href="#overview">Overview</a></li>
      <li><a href="#settings">Settings &amp; Configuration</a></li>
      <li><a href="#seeds">Seed Selection</a></li>
      <li><a href="#sources">Data Sources</a></li>
      <li><a href="#scoring">Scoring Formula</a></li>
      <li><a href="#popularity">Popularity Filter Levels</a></li>
      <li><a href="#pipeline">The Pipeline</a></li>
      <li><a href="#filtering">Filtering Rules</a></li>
      <li><a href="#watch-actions">Watch Actions</a></li>
    </ol>
  </nav>

  <!-- Section: Overview -->
  <section class="section" id="overview">
    <h2>1. Overview</h2>
    <p>
      Lekkerboxd analyzes your Letterboxd profile — your ratings, liked films, and watchlist — to
      recommend movies tailored to your taste. It cross-references multiple independent sources to
      surface films that are genuinely aligned with what you enjoy. A configurable popularity filter
      lets you decide how aggressively to penalize mainstream blockbusters, from no penalty at all
      to exclusively surfacing hidden gems.
    </p>
    <p>
      Every recommended film receives a score from <strong>0 to 100</strong>. This score reflects
      how strongly the engine believes the film matches your taste, factoring in how many of your
      favourite films led to it, how many independent sources agree, and the film's critical reception.
    </p>
  </section>

  <!-- Section: Settings -->
  <section class="section" id="settings">
    <h2>2. Settings &amp; Configuration</h2>
    <p>
      You can customize how Lekkerboxd generates recommendations via the Settings panel
      (gear icon in the popup). Here's what each setting controls:
    </p>

    <div class="settings-grid">
      <div class="setting-card">
        <h3>Seed Films</h3>
        <span class="setting-range">5 – 30 &middot; Default: 15</span>
        <p>
          The number of your top-rated and liked films used as the starting point for finding
          recommendations. More seeds cast a wider net but take longer to process.
        </p>
      </div>

      <div class="setting-card">
        <h3>Recommendations</h3>
        <span class="setting-range">5 – 30 &middot; Default: 20</span>
        <p>
          The number of recommendations returned in your final results. Fewer results means
          only the very best matches; more gives you a broader selection.
        </p>
      </div>

      <div class="setting-card full-width">
        <h3>Popularity Filter</h3>
        <span class="setting-range">4 levels</span>
        <p>
          Controls how aggressively mainstream blockbusters are penalized. Higher levels
          redistribute more of the scoring budget toward the popularity penalty, helping
          lesser-known films surface. See the <a href="#popularity">Popularity Filter Levels</a>
          section below for full details.
        </p>
        <div class="filter-levels-mini">
          <span class="level-pill off">Off</span>
          <span class="level-pill moderate">Moderate</span>
          <span class="level-pill aggressive">Aggressive</span>
          <span class="level-pill gems">Hidden Gems</span>
        </div>
      </div>

      <div class="setting-card full-width">
        <h3>Launch Mode</h3>
        <span class="setting-range">Advanced</span>
        <p>
          The extension opens as an attached dropdown by default. In Advanced settings, you can
          switch to a pop-out window mode if you prefer keeping recommendations open separately.
        </p>
      </div>

      <div class="setting-card full-width">
        <h3>TMDb Mode</h3>
        <span class="setting-range">Advanced</span>
        <p>
          TMDb requests use the default Lekkerboxd Cloudflare Worker proxy. This proxy URL is
          fixed in the app. If you enter your own TMDb API key in Settings, direct TMDb mode is
          used instead.
        </p>
        <p>
          The proxy enforces an extension-origin allowlist via <code>ALLOWED_ORIGIN</code> to
          protect the publisher TMDb key from unauthorized relay usage.
        </p>
      </div>

      <div class="setting-card full-width">
        <h3>JustWatch Region</h3>
        <span class="setting-range">Advanced</span>
        <p>
          Controls JustWatch routing when you click the eye button on a recommendation card.
          <strong>Auto</strong> opens the US direct film page. Manual country selection first tries
          that country's direct film page and falls back to the selected country's search page if needed.
        </p>
      </div>
    </div>
  </section>

  <!-- Section: Seed Selection -->
  <section class="section" id="seeds">
    <h2>3. Seed Selection</h2>
    <p>
      The engine starts by picking your <strong>top N films</strong> as "seeds" — the movies that
      best represent your taste (where N is your <em>Seed Films</em> setting, default 15).
      Seeds are chosen from your rated and liked films, sorted by a composite score:
    </p>
    <div class="formula-card">
      <code>seed score = your rating + 0.5 (if you liked it)</code>
    </div>
    <p>
      For example, a film you rated 4.5 stars and liked gets a seed score of 5.0, while a film
      rated 4.0 without a like gets 4.0. The top films by this score become the seeds that drive
      all recommendations.
    </p>
    <p>
      After seeds are selected, Lekkerboxd assigns a small weight by <strong>seed score group</strong>.
      Seeds with the same score always share the same weight. Higher seed-score groups get a slight
      priority multiplier (up to +20%) that is used later as a tie-break style ranking nudge.
    </p>
  </section>

  <!-- Section: Data Sources -->
  <section class="section" id="sources">
    <h2>4. Data Sources</h2>
    <p>
      For each seed film, Lekkerboxd queries multiple independent sources to find candidate
      recommendations. Using diverse sources reduces bias from any single algorithm. TMDb
      endpoints are queried for <strong>all seeds</strong>, while Reddit and Taste.io are
      queried for approximately the <strong>top 40% of seeds</strong> (minimum 4) to balance
      breadth with speed.
    </p>

    <div class="source-grid">
      <div class="source-card">
        <div class="source-header">
          <span class="source-icon tmdb">T</span>
          <div>
            <h3>TMDb Recommendations</h3>
            <span class="source-tag">All seeds</span>
          </div>
        </div>
        <p>
          The Movie Database's official recommendation engine. For each seed, TMDb returns films
          that users with similar taste also enjoyed. Fetched in parallel batches of 10.
        </p>
      </div>

      <div class="source-card">
        <div class="source-header">
          <span class="source-icon similar">S</span>
          <div>
            <h3>TMDb Similar</h3>
            <span class="source-tag">All seeds</span>
          </div>
        </div>
        <p>
          TMDb's content-based similarity engine. Finds films with similar genres, keywords,
          and themes — a different signal from the collaborative "recommendations" endpoint.
        </p>
      </div>

      <div class="source-card">
        <div class="source-header">
          <span class="source-icon reddit">R</span>
          <div>
            <h3>Reddit</h3>
            <span class="source-tag">Top 40% of seeds</span>
          </div>
        </div>
        <p>
          Searches five film-focused subreddits: <strong>r/IfYouLikeBlank</strong>,
          <strong>r/MovieSuggestions</strong>, <strong>r/flicks</strong>,
          <strong>r/TrueFilm</strong>, and <strong>r/criterion</strong>. Captures real human
          recommendations from discussion threads. Up to 6 results per seed.
        </p>
      </div>

      <div class="source-card">
        <div class="source-header">
          <span class="source-icon tasteio">t</span>
          <div>
            <h3>Taste.io</h3>
            <span class="source-tag">Top 40% of seeds</span>
          </div>
        </div>
        <p>
          Taste.io's "Movies Like" feature provides algorithmically curated similar films.
          Up to 10 results per seed, offering yet another independent perspective.
        </p>
      </div>
    </div>
  </section>

  <!-- Section: Scoring Formula -->
  <section class="section" id="scoring">
    <h2>5. Scoring Formula</h2>
    <p>
      Every candidate film receives a score from <strong>0 to 100</strong>. The score is built from
      four positive components and one penalty. The positive components are <strong>scaled
      proportionally</strong> based on your popularity filter level so that the theoretical maximum
      score is always 100, regardless of which filter you choose.
    </p>
    <p>
      Components are listed below from <strong>most to least weight</strong>:
    </p>

    <div class="scoring-table">
      <div class="score-row header-row">
        <span class="col-name">Component</span>
        <span class="col-range">Base Range</span>
        <span class="col-desc">How It Works</span>
      </div>

      <div class="score-row highlight">
        <span class="col-name">
          <span class="component-dot multi"></span>
          Multi-Source Bonus
        </span>
        <span class="col-range">0 – 38</span>
        <span class="col-desc">
          The biggest factor. Films found across 2 source types get half the max; across 3 or more
          get the full bonus. A film recommended by TMDb, Reddit, <em>and</em> Taste.io is very
          likely something you'd enjoy.
        </span>
      </div>

      <div class="score-row">
        <span class="col-name">
          <span class="component-dot freq"></span>
          Frequency
        </span>
        <span class="col-range">0 – 25</span>
        <span class="col-desc">
          How many of your seed films independently led to this recommendation.
          Each unique seed contributes proportional points toward the cap.
        </span>
      </div>

      <div class="score-row">
        <span class="col-name">
          <span class="component-dot source"></span>
          Source Weight
        </span>
        <span class="col-range">0 – 25</span>
        <span class="col-desc">
          Weighted sum of hits per source type: TMDb Recs &times; 8, Taste.io &times; 8,
          Reddit &times; 6, TMDb Similar &times; 5. Scaled and capped.
        </span>
      </div>

      <div class="score-row">
        <span class="col-name">
          <span class="component-dot rating"></span>
          TMDb Rating
        </span>
        <span class="col-range">0 – 12</span>
        <span class="col-desc">
          The film's TMDb vote average (0–10) normalized to the rating budget.
          A film rated 7.5 on TMDb contributes ~9 base points.
        </span>
      </div>

      <div class="score-row penalty">
        <span class="col-name">
          <span class="component-dot pop"></span>
          Popularity Penalty
        </span>
        <span class="col-range">Varies</span>
        <span class="col-desc">
          Deducts points from popular films based on their TMDb vote count and your
          chosen filter level. See the next section for the full breakdown per level.
        </span>
      </div>
    </div>

    <div class="formula-card">
      <div class="formula-label">Final Score</div>
      <code>
        score = Multi-Source + Frequency + Source Weight + TMDb Rating − Popularity Penalty
      </code>
      <div class="formula-note">
        Lekkerboxd then applies a seed-weight boost: it averages the connected seeds'
        relative weight bonuses, converts that to bonus points on the base score, and caps
        that bonus at +10 points. If boosted scores run well above the 0-100 display scale
        (highest score above 105), all boosted scores are scaled down proportionally so the
        highest becomes 100. The displayed score is this final normalized score (rounded),
        and ranking uses the same value.
      </div>
    </div>
  </section>

  <!-- Section: Popularity Filter Levels -->
  <section class="section" id="popularity">
    <h2>6. Popularity Filter Levels</h2>
    <p>
      The popularity filter controls how much of the scoring budget is allocated to penalizing
      popular films. At higher filter levels, positive component weights are <strong>scaled
      up proportionally</strong> so that the net maximum score (positive max minus the maximum
      possible penalty) is always <strong>100</strong>. This means a perfectly matched but very
      popular film can still score well, while lesser-known films get a meaningful boost.
    </p>

    <!-- Level 0 -->
    <div class="filter-level-card">
      <div class="filter-level-header">
        <span class="level-badge off">Off</span>
        <span class="level-desc">No penalty for popular films</span>
      </div>
      <div class="weights-table">
        <div class="weight-row header-row">
          <span>Component</span>
          <span>Max Points</span>
          <span>% of Score</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot multi"></span> Multi-Source Bonus</span>
          <span class="mono">38</span>
          <span class="mono">38%</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot freq"></span> Frequency</span>
          <span class="mono">25</span>
          <span class="mono">25%</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot source"></span> Source Weight</span>
          <span class="mono">25</span>
          <span class="mono">25%</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot rating"></span> TMDb Rating</span>
          <span class="mono">12</span>
          <span class="mono">12%</span>
        </div>
        <div class="weight-row penalty-row">
          <span><span class="component-dot pop"></span> Popularity Penalty</span>
          <span class="mono">0</span>
          <span class="mono">0%</span>
        </div>
        <div class="weight-row total-row">
          <span>Theoretical Max</span>
          <span class="mono">100</span>
          <span class="mono">100%</span>
        </div>
      </div>
    </div>

    <!-- Level 1 -->
    <div class="filter-level-card">
      <div class="filter-level-header">
        <span class="level-badge moderate">Moderate</span>
        <span class="level-desc">Slightly penalizes mainstream blockbusters</span>
      </div>
      <div class="weights-table">
        <div class="weight-row header-row">
          <span>Component</span>
          <span>Max Points</span>
          <span>% of Score</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot multi"></span> Multi-Source Bonus</span>
          <span class="mono">47.88</span>
          <span class="mono">38%</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot freq"></span> Frequency</span>
          <span class="mono">31.5</span>
          <span class="mono">25%</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot source"></span> Source Weight</span>
          <span class="mono">31.5</span>
          <span class="mono">25%</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot rating"></span> TMDb Rating</span>
          <span class="mono">15.12</span>
          <span class="mono">12%</span>
        </div>
        <div class="weight-row penalty-row">
          <span><span class="component-dot pop"></span> Popularity Penalty (max)</span>
          <span class="mono">−26</span>
          <span class="mono">21%</span>
        </div>
        <div class="weight-row total-row">
          <span>Net Max (126 − 26)</span>
          <span class="mono">100</span>
          <span class="mono">100%</span>
        </div>
      </div>
      <div class="penalty-tiers">
        <span class="tier-label">Penalty tiers:</span>
        <span class="tier">&gt;10k votes → −26</span>
        <span class="tier">&gt;5k votes → −17</span>
        <span class="tier">&gt;2k votes → −10</span>
      </div>
    </div>

    <!-- Level 2 -->
    <div class="filter-level-card">
      <div class="filter-level-header">
        <span class="level-badge aggressive">Aggressive</span>
        <span class="level-desc">Heavily penalizes popular films</span>
      </div>
      <div class="weights-table">
        <div class="weight-row header-row">
          <span>Component</span>
          <span>Max Points</span>
          <span>% of Score</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot multi"></span> Multi-Source Bonus</span>
          <span class="mono">53.96</span>
          <span class="mono">38%</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot freq"></span> Frequency</span>
          <span class="mono">35.5</span>
          <span class="mono">25%</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot source"></span> Source Weight</span>
          <span class="mono">35.5</span>
          <span class="mono">25%</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot rating"></span> TMDb Rating</span>
          <span class="mono">17.04</span>
          <span class="mono">12%</span>
        </div>
        <div class="weight-row penalty-row">
          <span><span class="component-dot pop"></span> Popularity Penalty (max)</span>
          <span class="mono">−42</span>
          <span class="mono">30%</span>
        </div>
        <div class="weight-row total-row">
          <span>Net Max (142 − 42)</span>
          <span class="mono">100</span>
          <span class="mono">100%</span>
        </div>
      </div>
      <div class="penalty-tiers">
        <span class="tier-label">Penalty tiers:</span>
        <span class="tier">&gt;10k votes → −42</span>
        <span class="tier">&gt;5k votes → −30</span>
        <span class="tier">&gt;2k votes → −18</span>
        <span class="tier">&gt;500 votes → −7</span>
      </div>
    </div>

    <!-- Level 3 -->
    <div class="filter-level-card">
      <div class="filter-level-header">
        <span class="level-badge gems">Hidden Gems</span>
        <span class="level-desc">Excludes films with over 5,000 TMDb votes</span>
      </div>
      <div class="weights-table">
        <div class="weight-row header-row">
          <span>Component</span>
          <span>Max Points</span>
          <span>% of Score</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot multi"></span> Multi-Source Bonus</span>
          <span class="mono">45.6</span>
          <span class="mono">38%</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot freq"></span> Frequency</span>
          <span class="mono">30</span>
          <span class="mono">25%</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot source"></span> Source Weight</span>
          <span class="mono">30</span>
          <span class="mono">25%</span>
        </div>
        <div class="weight-row">
          <span><span class="component-dot rating"></span> TMDb Rating</span>
          <span class="mono">14.4</span>
          <span class="mono">12%</span>
        </div>
        <div class="weight-row penalty-row">
          <span><span class="component-dot pop"></span> Popularity Penalty (max)</span>
          <span class="mono">−20</span>
          <span class="mono">17%</span>
        </div>
        <div class="weight-row total-row">
          <span>Net Max (120 − 20)</span>
          <span class="mono">100</span>
          <span class="mono">100%</span>
        </div>
      </div>
      <div class="penalty-tiers">
        <span class="tier-label">Penalty tiers:</span>
        <span class="tier">&gt;5k votes → excluded entirely</span>
        <span class="tier">&gt;2k votes → −20</span>
        <span class="tier">&gt;500 votes → −8</span>
      </div>
    </div>
  </section>

  <!-- Section: Pipeline -->
  <section class="section" id="pipeline">
    <h2>7. The Pipeline</h2>
    <p>
      Here's the full journey from your profile to your recommendations. Generation is handled by
      the extension service worker, so it can keep running while the popup is closed and results
      appear when you reopen it.
    </p>

    <div class="pipeline">
      <div class="pipe-step">
        <span class="pipe-num">1</span>
        <div class="pipe-content">
          <strong>Select seeds</strong>
          <span>Pick your top N rated + liked films (configurable, default 15)</span>
        </div>
      </div>
      <div class="pipe-connector"></div>

      <div class="pipe-step">
        <span class="pipe-num">2</span>
        <div class="pipe-content">
          <strong>Resolve IDs</strong>
          <span>Match each seed to a TMDb ID (cache-first, concurrent resolution)</span>
        </div>
      </div>
      <div class="pipe-connector"></div>

      <div class="pipe-step">
        <span class="pipe-num">3</span>
        <div class="pipe-content">
          <strong>TMDb candidates</strong>
          <span>Fetch recommendations + similar films for all seeds (batches of 10)</span>
        </div>
      </div>
      <div class="pipe-connector"></div>

      <div class="pipe-step dual">
        <span class="pipe-num">4</span>
        <div class="pipe-content">
          <strong>External sources</strong>
          <span>Search Reddit (5 subs) + Taste.io concurrently for top 40% of seeds</span>
        </div>
      </div>
      <div class="pipe-connector"></div>

      <div class="pipe-step">
        <span class="pipe-num">5</span>
        <div class="pipe-content">
          <strong>Resolve titles</strong>
          <span>Resolve capped external title set back to TMDb (rate-limited concurrent, confidence-checked)</span>
        </div>
      </div>
      <div class="pipe-connector"></div>

      <div class="pipe-step">
        <span class="pipe-num">6</span>
        <div class="pipe-content">
          <strong>Score &amp; filter</strong>
          <span>Apply scoring formula with your filter level, exclude watched films</span>
        </div>
      </div>
      <div class="pipe-connector"></div>

      <div class="pipe-step final">
        <span class="pipe-num">7</span>
        <div class="pipe-content">
          <strong>Top N</strong>
          <span>Apply capped seed boost + conditional normalization, then rank by final score and return Top N</span>
        </div>
      </div>
    </div>
  </section>

  <!-- Section: Filtering -->
  <section class="section" id="filtering">
    <h2>8. Filtering Rules</h2>
    <div class="filter-grid">
      <div class="filter-card excluded">
        <h3>Excluded</h3>
        <p>
          Films you've already <strong>watched</strong> (according to your Letterboxd profile)
          are completely removed from results. You won't see anything you've already seen.
        </p>
      </div>
      <div class="filter-card flagged">
        <h3>Flagged</h3>
        <p>
          Films on your <strong>watchlist</strong> are kept in results but marked with a
          "Watchlist" badge — a sign the algorithm agrees with your picks.
        </p>
      </div>
      <div class="filter-card hidden-gems">
        <h3>Hard Exclusion</h3>
        <p>
          When the popularity filter is set to <strong>Hidden Gems</strong>, films with over
          5,000 TMDb votes are removed entirely before scoring — they never appear in results.
        </p>
      </div>
    </div>
  </section>

  <!-- Section: Watch actions -->
  <section class="section" id="watch-actions">
    <h2>9. Watch Actions</h2>
    <p>
      Each recommendation card includes an eye button that opens
      <strong>JustWatch</strong> so you can check which streaming services carry that film.
      Auto mode opens the US direct film page; manual region mode prefers a direct regional page
      and falls back to regional search if the direct URL is unavailable.
    </p>
    <p>
      You can add recommended films directly to your Letterboxd watchlist without leaving the
      extension. Each recommendation card has a <strong>+</strong> button in the bottom-right corner.
    </p>
    <p>
      Before sending the watchlist request, Lekkerboxd resolves the recommendation to a canonical
      Letterboxd film slug and uses title/year matching as a fallback for ambiguous titles. This
      reduces wrong-film adds when multiple movies share similar names.
    </p>

    <div class="watchlist-states">
      <div class="wl-state-card">
        <span class="wl-demo-btn demo-idle">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
        </span>
        <div>
          <strong>Add</strong>
          <span>Click to add the film to your Letterboxd watchlist</span>
        </div>
      </div>

      <div class="wl-state-card">
        <span class="wl-demo-btn demo-loading">
          <span class="wl-demo-spinner"></span>
        </span>
        <div>
          <strong>Adding</strong>
          <span>The request is being sent to Letterboxd</span>
        </div>
      </div>

      <div class="wl-state-card">
        <span class="wl-demo-btn demo-added">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="#00E054" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <div>
          <strong>On watchlist</strong>
          <span>The film has been added, or was already on your watchlist</span>
        </div>
      </div>
    </div>

    <p>
      You must be logged into Letterboxd in your browser for this to work. If you're not logged in,
      clicking the button will open the film's Letterboxd page instead so you can add it manually.
    </p>
    <p>
      If Letterboxd parsing or watchlist endpoints appear unstable, Lekkerboxd enters a temporary
      degraded mode: it surfaces a warning banner, keeps using cached recommendation data where
      possible, and falls back to opening Letterboxd film pages for watchlist actions.
    </p>
    <p>
      Your watchlist additions are remembered across popup sessions — if you close and reopen the
      extension, films you've added will still show the green checkmark.
    </p>
  </section>

  <footer class="doc-footer">
    <a class="tmdb-attr" href="https://www.themoviedb.org/" target="_blank" rel="noopener">
      <img src={tmdbLogoLong} alt="Powered by TMDb" height="14" />
    </a>
    <p>Lekkerboxd &middot; Built for film lovers who want to dig deeper</p>
  </footer>
</div>

<style>
  /* ── Page layout ── */
  .doc {
    max-width: 680px;
    margin: 0 auto;
    padding: 32px 24px 48px;
  }

  /* ── Header ── */
  .doc-header {
    text-align: center;
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid #2C3641;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }

  .logo-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #00E054;
  }

  .logo-text {
    font-size: 14px;
    font-weight: 700;
    color: #789;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .doc-header h1 {
    margin: 0 0 8px;
    font-size: 28px;
    font-weight: 700;
    color: #fff;
    line-height: 1.2;
  }

  .subtitle {
    margin: 0;
    font-size: 15px;
    color: #567;
  }

  /* ── Table of Contents ── */
  .toc {
    background: #1B2028;
    border: 1px solid #2C3641;
    border-radius: 8px;
    padding: 18px 24px;
    margin-bottom: 36px;
  }

  .toc-title {
    margin: 0 0 12px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #567;
    font-weight: 600;
  }

  .toc-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    counter-reset: toc;
  }

  .toc-list li {
    counter-increment: toc;
  }

  .toc-list li::before {
    content: counter(toc) ".";
    display: inline-block;
    width: 22px;
    color: #567;
    font-size: 13px;
    font-weight: 600;
  }

  .toc-list a {
    font-size: 13px;
    color: #9AB;
    text-decoration: none;
    transition: color 0.15s;
  }

  .toc-list a:hover {
    color: #00E054;
  }

  /* ── Sections ── */
  .section {
    margin-bottom: 36px;
    scroll-margin-top: 24px;
  }

  .section h2 {
    font-size: 18px;
    font-weight: 700;
    color: #DEF;
    margin: 0 0 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #2C3641;
  }

  .section p {
    margin: 0 0 12px;
    font-size: 14px;
    line-height: 1.65;
    color: #9AB;
  }

  .section strong {
    color: #DEF;
  }

  .section em {
    color: #9AB;
    font-style: italic;
  }

  .section a {
    color: #00E054;
    text-decoration: none;
  }

  .section a:hover {
    text-decoration: underline;
  }

  /* ── Formula card ── */
  .formula-card {
    background: #1B2028;
    border: 1px solid #2C3641;
    border-radius: 8px;
    padding: 14px 18px;
    margin: 16px 0;
    text-align: center;
  }

  .formula-card code {
    font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, monospace;
    font-size: 13px;
    color: #00E054;
    line-height: 1.6;
  }

  .formula-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #567;
    margin-bottom: 8px;
    font-weight: 600;
  }

  .formula-note {
    font-size: 11px;
    color: #567;
    margin-top: 8px;
  }

  /* ── Settings grid ── */
  .settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 16px;
  }

  .setting-card {
    background: #1B2028;
    border: 1px solid #2C3641;
    border-radius: 8px;
    padding: 14px;
  }

  .setting-card.full-width {
    grid-column: 1 / -1;
  }

  .setting-card h3 {
    margin: 0 0 2px;
    font-size: 13px;
    font-weight: 600;
    color: #DEF;
  }

  .setting-range {
    font-size: 10px;
    color: #00E054;
    font-weight: 600;
    font-family: "SF Mono", "Fira Code", Menlo, monospace;
  }

  .setting-card p {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.55;
    color: #789;
  }

  .filter-levels-mini {
    display: flex;
    gap: 6px;
    margin-top: 10px;
    flex-wrap: wrap;
  }

  .level-pill {
    font-size: 10px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 10px;
    color: #fff;
  }

  .level-pill.off { background: #2C3440; color: #789; }
  .level-pill.moderate { background: rgba(0, 224, 84, 0.2); color: #00E054; }
  .level-pill.aggressive { background: rgba(255, 128, 0, 0.2); color: #FF8000; }
  .level-pill.gems { background: rgba(168, 85, 247, 0.2); color: #A855F7; }

  /* ── Source grid ── */
  .source-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 16px;
  }

  .source-card {
    background: #1B2028;
    border: 1px solid #2C3641;
    border-radius: 8px;
    padding: 14px;
  }

  .source-card p {
    font-size: 12px;
    line-height: 1.55;
    color: #789;
    margin: 0;
  }

  .source-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .source-header h3 {
    margin: 0;
    font-size: 13px;
    color: #DEF;
    font-weight: 600;
  }

  .source-tag {
    font-size: 10px;
    color: #567;
  }

  .source-icon {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .source-icon.tmdb { background: rgba(1, 180, 228, 0.15); color: #01B4E4; }
  .source-icon.similar { background: rgba(1, 180, 228, 0.08); color: #01B4E4; }
  .source-icon.reddit { background: rgba(255, 69, 0, 0.12); color: #FF4500; }
  .source-icon.tasteio { background: rgba(168, 85, 247, 0.12); color: #A855F7; }

  /* ── Scoring table ── */
  .scoring-table {
    margin: 16px 0;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #2C3641;
  }

  .score-row {
    display: grid;
    grid-template-columns: 175px 90px 1fr;
    padding: 12px 14px;
    gap: 12px;
    align-items: start;
    border-bottom: 1px solid #2C3641;
    background: #1B2028;
  }

  .score-row:last-child { border-bottom: none; }

  .score-row.header-row {
    background: #0D1117;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #567;
    font-weight: 600;
    padding: 10px 14px;
  }

  .score-row.highlight {
    background: rgba(0, 224, 84, 0.04);
  }

  .score-row.penalty {
    background: rgba(255, 80, 80, 0.04);
  }

  .col-name {
    font-size: 13px;
    font-weight: 600;
    color: #DEF;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .col-range {
    font-size: 13px;
    font-family: "SF Mono", "Fira Code", Menlo, monospace;
    color: #789;
  }

  .col-desc {
    font-size: 12px;
    line-height: 1.5;
    color: #789;
  }

  .component-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    display: inline-block;
  }

  .component-dot.freq { background: #00E054; }
  .component-dot.source { background: #40BCF4; }
  .component-dot.rating { background: #F5C518; }
  .component-dot.multi { background: #A855F7; }
  .component-dot.pop { background: #FF4500; }

  /* ── Filter level cards ── */
  .filter-level-card {
    background: #1B2028;
    border: 1px solid #2C3641;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 14px;
  }

  .filter-level-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }

  .level-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 12px;
    color: #fff;
    white-space: nowrap;
  }

  .level-badge.off { background: #2C3440; color: #9AB; }
  .level-badge.moderate { background: #00E054; }
  .level-badge.aggressive { background: #FF8000; }
  .level-badge.gems { background: #A855F7; }

  .level-desc {
    font-size: 12px;
    color: #789;
  }

  /* ── Weights table ── */
  .weights-table {
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #2C3641;
  }

  .weight-row {
    display: grid;
    grid-template-columns: 1fr 90px 80px;
    padding: 8px 12px;
    align-items: center;
    border-bottom: 1px solid #1a2030;
    background: #14181C;
    font-size: 12px;
    color: #9AB;
    gap: 8px;
  }

  .weight-row:last-child { border-bottom: none; }

  .weight-row.header-row {
    background: #0D1117;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #567;
    font-weight: 600;
    padding: 7px 12px;
  }

  .weight-row.penalty-row {
    background: rgba(255, 80, 80, 0.04);
    color: #f88;
  }

  .weight-row.total-row {
    background: rgba(0, 224, 84, 0.06);
    font-weight: 700;
    color: #00E054;
  }

  .weight-row .mono {
    font-family: "SF Mono", "Fira Code", Menlo, monospace;
    text-align: right;
  }

  .weight-row span:first-child {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .penalty-tiers {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
    align-items: center;
  }

  .tier-label {
    font-size: 10px;
    color: #567;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .tier {
    font-size: 11px;
    color: #789;
    background: #14181C;
    padding: 3px 8px;
    border-radius: 4px;
    font-family: "SF Mono", "Fira Code", Menlo, monospace;
  }

  /* ── Pipeline ── */
  .pipeline {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    margin: 16px 0;
  }

  .pipe-step {
    display: flex;
    gap: 14px;
    padding: 12px 14px;
    background: #1B2028;
    border: 1px solid #2C3641;
    border-radius: 8px;
    align-items: center;
  }

  .pipe-step.dual {
    border-color: #40BCF4;
    border-style: dashed;
  }

  .pipe-step.final {
    border-color: #00E054;
  }

  .pipe-num {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #2C3440;
    color: #9AB;
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .pipe-step.final .pipe-num {
    background: #00E054;
    color: #fff;
  }

  .pipe-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .pipe-content strong {
    font-size: 13px;
    color: #DEF;
  }

  .pipe-content span {
    font-size: 11px;
    color: #567;
  }

  .pipe-connector {
    width: 2px;
    height: 12px;
    background: #2C3641;
    margin-left: 26px;
  }

  /* ── Filter cards ── */
  .filter-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
    margin-top: 12px;
  }

  .filter-card {
    padding: 14px;
    border-radius: 8px;
    background: #1B2028;
    border: 1px solid #2C3641;
  }

  .filter-card h3 {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 600;
  }

  .filter-card p {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: #789;
  }

  .filter-card.excluded h3 { color: #f88; }
  .filter-card.flagged h3 { color: #40BCF4; }
  .filter-card.hidden-gems h3 { color: #A855F7; }

  /* ── Watchlist states ── */
  .watchlist-states {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 16px 0;
  }

  .wl-state-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    background: #1B2028;
    border: 1px solid #2C3641;
    border-radius: 8px;
  }

  .wl-state-card strong {
    font-size: 13px;
    color: #DEF;
    display: block;
  }

  .wl-state-card span {
    font-size: 11px;
    color: #567;
  }

  .wl-demo-btn {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1px solid #2C3641;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: #789;
  }

  .wl-demo-btn.demo-added {
    border-color: rgba(0, 224, 84, 0.3);
  }

  .wl-demo-btn.demo-loading {
    border-color: #2C3641;
  }

  .wl-demo-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid rgba(120, 153, 170, 0.3);
    border-top-color: #789;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Footer ── */
  .doc-footer {
    margin-top: 48px;
    padding-top: 20px;
    border-top: 1px solid #2C3641;
    text-align: center;
  }

  .tmdb-attr {
    display: inline-block;
    margin-bottom: 10px;
    opacity: 0.6;
    transition: opacity 0.15s;
  }

  .tmdb-attr:hover { opacity: 0.9; }

  .tmdb-attr img { display: block; }

  .doc-footer p {
    margin: 0;
    font-size: 12px;
    color: #456;
  }

  /* ── Responsive ── */
  @media (max-width: 600px) {
    .source-grid, .settings-grid {
      grid-template-columns: 1fr;
    }

    .setting-card.full-width {
      grid-column: auto;
    }

    .filter-grid {
      grid-template-columns: 1fr;
    }

    .score-row {
      grid-template-columns: 1fr;
      gap: 4px;
    }

    .score-row.header-row { display: none; }

    .col-range {
      font-size: 11px;
      color: #567;
    }

    .weight-row {
      grid-template-columns: 1fr 70px 60px;
      font-size: 11px;
    }
  }
</style>
