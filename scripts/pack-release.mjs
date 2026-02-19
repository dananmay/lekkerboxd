import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const outputName = process.argv[2];
if (!outputName || !outputName.endsWith('.zip')) {
  console.error('Usage: node scripts/pack-release.mjs <output.zip>');
  process.exit(1);
}

const root = process.cwd();
const distDir = path.join(root, 'dist');
const outputPath = path.join(root, outputName);

if (!fs.existsSync(distDir)) {
  console.error('dist/ not found. Run a build first.');
  process.exit(1);
}

if (fs.existsSync(outputPath)) {
  fs.unlinkSync(outputPath);
}

const zipResult = spawnSync('zip', ['-r', outputPath, '.'], {
  cwd: distDir,
  stdio: 'inherit',
});

if (zipResult.status !== 0) {
  process.exit(zipResult.status ?? 1);
}

