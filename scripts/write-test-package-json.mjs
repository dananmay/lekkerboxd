import fs from 'node:fs';
import path from 'node:path';

const outDir = path.join(process.cwd(), '.test-dist');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
  'utf8',
);
