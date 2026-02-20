import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];

function logIssues() {
  warnings.forEach(message => {
    console.warn(`[doctor][warn] ${message}`);
  });
  errors.forEach(message => {
    console.error(`[doctor][error] ${message}`);
  });
}

function ensureNode20() {
  const version = process.versions.node;
  const major = Number(version.split('.')[0]);
  if (major !== 20) {
    errors.push(`Detected Node ${version}. Use Node 20.x (run: nvm use 20).`);
  }
}

function noteDesktopWorkspaceRisk() {
  if (rootDir.includes('/Desktop/')) {
    warnings.push(
      `Workspace is under Desktop (${rootDir}). File-sync tools can create duplicate '* 2' artifacts.`,
    );
  }
}

function collectTrackedFiles() {
  const result = spawnSync('git', ['ls-files'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout.split('\n').map(line => line.trim()).filter(Boolean);
}

function hasDuplicateSuffix(filePath) {
  return path.basename(filePath).endsWith(' 2');
}

function scanForDuplicateArtifacts() {
  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (hasDuplicateSuffix(fullPath)) {
        errors.push(`Duplicate artifact found: ${fullPath}`);
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }
}

function checkCriticalFilesNotEmpty() {
  const trackedFiles = collectTrackedFiles();
  const criticalExtensions = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.mjs',
    '.json',
    '.svelte',
    '.html',
    '.css',
    '.yml',
    '.yaml',
    '.toml',
  ]);
  const alwaysCritical = new Set([
    'package.json',
    'manifest.json',
    'vite.config.ts',
    'scripts/build-channel.mjs',
  ]);

  for (const relativePath of trackedFiles) {
    const ext = path.extname(relativePath);
    const isCritical =
      alwaysCritical.has(relativePath) ||
      (relativePath.startsWith('src/') && criticalExtensions.has(ext)) ||
      (relativePath.startsWith('scripts/') && criticalExtensions.has(ext));
    if (!isCritical) continue;

    const absPath = path.join(rootDir, relativePath);
    try {
      const stat = fs.statSync(absPath);
      if (stat.size === 0) {
        errors.push(`Critical file is empty: ${absPath}`);
      }
    } catch {
      errors.push(`Critical file is missing/unreadable: ${absPath}`);
    }
  }
}

ensureNode20();
noteDesktopWorkspaceRisk();
scanForDuplicateArtifacts();
checkCriticalFilesNotEmpty();
logIssues();

if (errors.length > 0) {
  process.exit(1);
}

console.log('[doctor] OK');
