// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Hand the built zip to the house, so the app's Settings button can find it:
// copies dist/Aerie-<version>-win.zip to data/app/desktop/ and writes
// version.json beside it (read by packages/backend/src/routes/app.ts).
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const signing = createRequire(import.meta.url)('./update-signature.cjs');

// The signing key lives OUTSIDE the repo, readable only by this account.
// AERIE_DESKTOP_SIGNING_KEY names another file if a house keeps it elsewhere.
const keyFile = process.env.AERIE_DESKTOP_SIGNING_KEY || join(homedir(), '.config', 'aerie', 'desktop-update-key.pem');

// `node stage.mjs --keygen`: make the key once, then put the printed public
// key in house.json as "updateKey" and build the app, so it trusts only this.
if (process.argv.includes('--keygen')) {
  if (existsSync(keyFile)) {
    console.log(`A key is already at ${keyFile}; its public half:`);
    console.log(signing.publicRawOf(readFileSync(keyFile, 'utf8')));
    process.exit(0);
  }
  const pair = signing.newSigningPair();
  mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(keyFile, pair.privatePem, { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  console.log(`Made ${keyFile}. Put this in desktop/house.json as "updateKey":`);
  console.log(pair.publicRaw);
  process.exit(0);
}
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
const record = { version, file };
// Sign it when this house has a key. An app built with an updateKey refuses
// an unsigned zip, so a house that has made a key must stage with it.
if (existsSync(keyFile)) {
  const sha256 = signing.sha256Of(readFileSync(built));
  record.sha256 = sha256;
  record.signature = signing.signUpdate(version, sha256, readFileSync(keyFile, 'utf8'));
}
writeFileSync(`${meta}.tmp`, JSON.stringify(record, null, 2));
renameSync(`${meta}.tmp`, meta);
console.log(`Staged ${file} as version ${version}${record.signature ? ', signed' : ', UNSIGNED (no key at ' + keyFile + ')'}.`);
