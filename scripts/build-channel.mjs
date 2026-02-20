import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const channel = process.argv[2] === 'github' ? 'github' : 'store';
const viteCli = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
const outDir = channel === 'github' ? 'dist-github' : 'dist-store';
const lockFile = path.join(process.cwd(), '.build-channel.lock.json');

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    if (!fs.existsSync(lockFile)) return;
    const content = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (content?.pid === process.pid) {
      fs.rmSync(lockFile, { force: true });
    }
  } catch {
    fs.rmSync(lockFile, { force: true });
  }
}

try {
  if (fs.existsSync(lockFile)) {
    const content = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (processAlive(content?.pid)) {
      console.error(
        `[build-channel] Another build is already running (pid ${content.pid}, channel ${content.channel}).`,
      );
      console.error('[build-channel] Wait for it to finish or stop it before starting a new build.');
      process.exit(1);
    }
    fs.rmSync(lockFile, { force: true });
  }
} catch {
  fs.rmSync(lockFile, { force: true });
}

fs.writeFileSync(
  lockFile,
  JSON.stringify(
    {
      pid: process.pid,
      channel,
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

process.on('exit', releaseLock);
process.on('SIGINT', () => {
  releaseLock();
  process.exit(130);
});
process.on('SIGTERM', () => {
  releaseLock();
  process.exit(143);
});
process.on('uncaughtException', error => {
  releaseLock();
  throw error;
});

const result = spawnSync(process.execPath, [viteCli, 'build', '--outDir', outDir], {
  stdio: 'inherit',
  env: {
    ...process.env,
    LEKKERBOXD_CHANNEL: channel,
  },
});

if (result.status !== 0) {
  releaseLock();
  process.exit(result.status ?? 1);
}

releaseLock();
