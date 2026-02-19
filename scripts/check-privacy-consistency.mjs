import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'manifest.json');
const privacyPath = path.join(root, 'src', 'privacy', 'PrivacyPolicy.svelte');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const privacy = fs.readFileSync(privacyPath, 'utf8').toLowerCase();

const requiredPermissionMentions = ['storage', 'tabs', 'cookies'];
const requiredHostMentions = [
  'letterboxd',
  'api.themoviedb.org',
  'lekkerboxd-tmdb-proxy',
  'justwatch.com',
  'reddit.com',
  'taste.io',
];

const manifestPermissions = manifest.permissions ?? [];
const manifestHosts = manifest.host_permissions ?? [];

let failed = false;

for (const permission of manifestPermissions) {
  if (!requiredPermissionMentions.includes(permission)) {
    console.warn(`warning: manifest permission "${permission}" is not covered by the policy checker list`);
  }
}

for (const mention of requiredPermissionMentions) {
  if (!privacy.includes(mention)) {
    console.error(`missing privacy mention: "${mention}"`);
    failed = true;
  }
}

for (const host of manifestHosts) {
  const normalized = String(host).replace('*://*.', '').replace('https://', '').replace('/*', '');
  const hasMention = requiredHostMentions.some(mention => normalized.includes(mention));
  if (!hasMention) {
    console.warn(`warning: host "${host}" is not covered by the policy checker list`);
  }
}

for (const mention of requiredHostMentions) {
  if (!privacy.includes(mention)) {
    console.error(`missing privacy host mention: "${mention}"`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log('privacy consistency check passed');
