// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Hand the built zip to the house, so the app's Settings button can find it:
// copies dist/Aerie-<version>-win.zip to data/app/desktop/ and writes
// version.json beside it (read by packages/backend/src/routes/app.ts).
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const file = `Aerie-${version}-win.zip`;
const built = join(here, 'dist', file);
if (!existsSync(built)) {
  console.error(`No ${file} in dist/; run npm run build:win first.`);
  process.exit(1);
}
const out = join(here, '..', 'data', 'app', 'desktop');
mkdirSync(out, { recursive: true });
copyFileSync(built, join(out, file));
const meta = join(out, 'version.json');
writeFileSync(`${meta}.tmp`, JSON.stringify({ version, file }, null, 2));
renameSync(`${meta}.tmp`, meta);
console.log(`Staged ${file} as version ${version}.`);
