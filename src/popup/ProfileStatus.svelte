<script lang="ts">
  import type { UserProfile } from '../types/letterboxd';

  interface Props {
    profile: UserProfile | null;
    username: string;
  }

  let { profile, username }: Props = $props();

  function timeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
</script>

{#if !username}
  <div class="status-bar empty">
    Visit any Letterboxd page while logged in to get started.
  </div>
{:else if !profile}
  <div class="status-bar pending">
    Profile "{username}" not yet scanned. Click "Get Recommendations" or "Scan Profile" in Settings.
  </div>
{:else}
  <div class="status-bar ready">
    <div class="profile-name">
      <a href="https://letterboxd.com/{username}" target="_blank" rel="noopener">
        {username}
      </a>
      <span class="scanned-time">Scanned {timeAgo(profile.scrapedAt)}</span>
    </div>
    <div class="stats">
      <span class="stat">{profile.watchedFilms.length} watched</span>
      <span class="stat">{profile.ratedFilms.length} rated</span>
      <span class="stat">{profile.likedFilms.length} liked</span>
      <span class="stat">{profile.watchlist.length} watchlist</span>
    </div>
  </div>
{/if}

<style>
  .status-bar {
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.4;
  }

  .empty, .pending {
    background: #1B2028;
    color: #789;
    border: 1px dashed #456;
  }

  .ready {
    background: #1B2028;
    border: 1px solid #2C3641;
    color: #9AB;
  }

  .profile-name {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }

  .profile-name a {
    color: #00E054;
    text-decoration: none;
    font-weight: 600;
    font-size: 13px;
  }

  .profile-name a:hover {
    text-decoration: underline;
  }

  .scanned-time {
    color: #567;
    font-size: 10px;
  }

  .stats {
    display: flex;
    gap: 12px;
  }

  .stat {
    font-size: 11px;
    color: #789;
  }
</style>
