// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The laptop app installs only a zip signed by the key it was built with
// (desktop/update-signature.cjs), and the house hands the hash and signature
// along with the version (routes/app.ts parseDesktopMeta).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDesktopMeta } from './app.js';

interface Signing {
  sha256Of(b: Buffer): string;
  publicKeyFrom(raw: unknown): unknown;
  newSigningPair(): { privatePem: string; publicRaw: string };
  publicRawOf(pem: string): string;
  signUpdate(version: string, sha256: string, pem: string): string;
  verifyUpdate(meta: unknown, zip: Buffer, key: unknown): { ok: boolean; reason?: string };
}

const here = fileURLToPath(new URL('.', import.meta.url));
const signing = createRequire(import.meta.url)(join(here, '..', '..', '..', '..', 'desktop', 'update-signature.cjs')) as Signing;

function staged(zip: Buffer, version = '1.2.0') {
  const pair = signing.newSigningPair();
  const sha256 = signing.sha256Of(zip);
  return { pair, key: signing.publicKeyFrom(pair.publicRaw), meta: { version, sha256, signature: signing.signUpdate(version, sha256, pair.privatePem) } };
}

test('a zip signed by the built-in key installs', () => {
  const zip = Buffer.from('a whole laptop app');
  const { pair, key, meta } = staged(zip);
  assert.deepEqual(signing.verifyUpdate(meta, zip, key), { ok: true });
  assert.equal(signing.publicRawOf(pair.privatePem), pair.publicRaw);
});

test('a changed zip, a swapped version, another key or no signature is refused', () => {
  const zip = Buffer.from('a whole laptop app');
  const { key, meta } = staged(zip);
  const changed = Buffer.from(zip); changed[0] ^= 1;
  assert.equal(signing.verifyUpdate(meta, changed, key).ok, false, 'one byte changed');
  // Hash recomputed for the changed zip, signature left as it was.
  assert.equal(signing.verifyUpdate({ ...meta, sha256: signing.sha256Of(changed) }, changed, key).ok, false, 'hash swapped to match');
  assert.equal(signing.verifyUpdate({ ...meta, version: '9.9.9' }, zip, key).ok, false, 'version swapped');
  const other = staged(zip);
  assert.equal(signing.verifyUpdate(other.meta, zip, key).ok, false, "another house's key");
  assert.equal(signing.verifyUpdate({ version: meta.version }, zip, key).ok, false, 'unsigned');
  assert.equal(signing.verifyUpdate(meta, zip, null).ok, false, 'no key built in');
  assert.equal(signing.publicKeyFrom('not a key'), null);
});

test('the house passes a well-formed hash and signature along, and drops a malformed one', () => {
  const zip = Buffer.from('a whole laptop app');
  const { meta } = staged(zip);
  const good = parseDesktopMeta({ ...meta, file: 'Aerie-1.2.0-win.zip' });
  assert.equal(good?.signature, meta.signature);
  assert.equal(good?.sha256, meta.sha256);
  const bad = parseDesktopMeta({ ...meta, file: 'Aerie-1.2.0-win.zip', signature: 'x' });
  assert.equal(bad?.signature, undefined);
  assert.equal(bad?.sha256, undefined);
  assert.equal(parseDesktopMeta({ version: '1', file: '../evil.zip' }), null);
});
