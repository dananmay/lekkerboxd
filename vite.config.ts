import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { crx } from '@crxjs/vite-plugin';
import baseManifest from './manifest.json';

const TMDB_PROXY_HOST = 'https://lekkerboxd-tmdb-proxy.lekkerboxd.workers.dev/*';
const buildChannel = process.env.LEKKERBOXD_CHANNEL === 'github' ? 'github' : 'store';

function resolveManifest() {
  const manifest = JSON.parse(JSON.stringify(baseManifest)) as typeof baseManifest;
  if (buildChannel === 'github') {
    manifest.host_permissions = (manifest.host_permissions ?? []).filter(
      host => host !== TMDB_PROXY_HOST,
    );
  }
  return manifest;
}

export default defineConfig({
  define: {
    __LEKKERBOXD_CHANNEL__: JSON.stringify(buildChannel),
  },
  plugins: [
    svelte(),
    crx({ manifest: resolveManifest() }),
  ],
  build: {
    rollupOptions: {
      input: {
        popup: 'src/popup/index.html',
        scoring: 'src/scoring/index.html',
        privacy: 'src/privacy/index.html',
      },
    },
  },
});
