import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  'node_modules',
  'dist',
  'dist-store',
  'dist-github',
  '.test-dist',
];

for (const target of targets) {
  const absPath = path.join(rootDir, target);
  fs.rmSync(absPath, { recursive: true, force: true });
  console.log(`[clean] removed ${absPath}`);
}
