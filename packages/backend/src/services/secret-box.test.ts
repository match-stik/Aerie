// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Keys at rest: a stored secret is ciphertext in the table and plain only
// through getSecret; older plain rows still read and get sealed at start; the
// sealed backup carries them opened, so a restore needs no key file.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';

const dir = mkdtempSync(join(tmpdir(), 'secret-box-'));
process.env.AERIE_SECRETS_KEY_FILE = join(dir, 'keys', 'secrets.key');

const { initDb } = await import('./db/init.js');
const { getConfig, setConfig } = await import('./db.js');
const { getSecret, setSecret, listSecretsByPrefix, sealPlainSecrets } = await import('./secrets.js');
const { isSealedValue, openValue, sealValue, resetSecretsKeyCache } = await import('./secret-box.js');
const { keysFromPhrase, makeSealedBackup, openSealed } = await import('./sealed-backup.js');

const db = initDb(':memory:');
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a stored key is ciphertext in the table and plain through getSecret', () => {
  setSecret('groq_api_key', 'gsk_live_value');
  const raw = getConfig('secret:groq_api_key');
  assert.ok(isSealedValue(raw), 'the row is sealed');
  assert.ok(!raw!.includes('gsk_live_value'));
  assert.equal(getSecret('groq_api_key'), 'gsk_live_value');
  const mode = statSync(process.env.AERIE_SECRETS_KEY_FILE!).mode & 0o777;
  assert.equal(mode, 0o600, 'the key file is owner-only');
});

test('a sealed value cannot be moved under another row or opened by another key', () => {
  const raw = getConfig('secret:groq_api_key')!;
  setConfig('secret:github_token', raw);
  assert.equal(getSecret('github_token'), undefined, 'moved under another name');
  assert.equal(openValue(raw, Buffer.alloc(32, 7), 'secret:groq_api_key'), null, 'another key');
  setConfig('secret:github_token', '');
});

test('an older plain row still reads, and is sealed at start', () => {
  setConfig('secret:elevenlabs_voice_id:ivy', 'voice123');
  assert.equal(getSecret('elevenlabs_voice_id:ivy'), 'voice123');
  assert.deepEqual(listSecretsByPrefix('elevenlabs_voice_id:'), { 'elevenlabs_voice_id:ivy': 'voice123' });
  assert.equal(sealPlainSecrets(), 1);
  assert.ok(isSealedValue(getConfig('secret:elevenlabs_voice_id:ivy')));
  assert.deepEqual(listSecretsByPrefix('elevenlabs_voice_id:'), { 'elevenlabs_voice_id:ivy': 'voice123' });
  assert.equal(sealPlainSecrets(), 0, 'nothing left to seal');
});

test('with sealing off, new values are written plain', () => {
  setConfig('secrets.at_rest', 'off');
  setSecret('giphy_api_key', 'plain-one');
  assert.equal(getConfig('secret:giphy_api_key'), 'plain-one');
  setConfig('secrets.at_rest', '');
  setSecret('giphy_api_key', 'sealed-one');
  assert.ok(isSealedValue(getConfig('secret:giphy_api_key')));
});

test('the sealed backup carries the keys opened, so a restore needs no key file', async () => {
  const { publicRaw, privateKey } = keysFromPhrase('test phrase for the keys at rest backup');
  const out = join(dir, 'backups');
  const made = await makeSealedBackup({ db, publicKeyRaw: publicRaw, dir: out });
  const { readFileSync, writeFileSync } = await import('node:fs');
  const plainDb = gunzipSync(await openSealed(readFileSync(made.file), privateKey));
  const restored = join(dir, 'restored.db');
  writeFileSync(restored, plainDb);
  const r = new Database(restored, { readonly: true });
  const row = r.prepare("SELECT value FROM config WHERE key = 'secret:groq_api_key'").get() as { value: string };
  r.close();
  assert.equal(row.value, 'gsk_live_value');
  // The live table is untouched by the backup.
  assert.ok(isSealedValue(getConfig('secret:groq_api_key')));
  resetSecretsKeyCache();
  assert.ok(sealValue('x', Buffer.alloc(32), 'n').startsWith('enc1:'));
});
