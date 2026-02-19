import { spawnSync } from 'node:child_process';
import path from 'node:path';

const channel = process.argv[2] === 'github' ? 'github' : 'store';
const viteCli = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');

const result = spawnSync(process.execPath, [viteCli, 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    LEKKERBOXD_CHANNEL: channel,
  },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
