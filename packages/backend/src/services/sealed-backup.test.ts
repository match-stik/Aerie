// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The house can seal a backup and cannot open it; the phrase can, and any
// change to the file is caught.
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { keysFromPhrase, listSealedBackups, makeSealedBackup, openSealed, sealStream, normalizePhrase } from './sealed-backup.js';

const PHRASE = 'K7QF-2M9X-PL4D-88WZ-QH3T-RN6V-B2CY-J5SA';

async function seal(data: Buffer, publicRaw: Buffer): Promise<Buffer> {
  const { publicKeyFromRaw } = await import('./sealed-backup.js');
  const parts: Buffer[] = [];
  async function* src() { for (let i = 0; i < data.length; i += 700_000) yield data.subarray(i, i + 700_000); }
  await sealStream(src(), publicKeyFromRaw(publicRaw), (b) => parts.push(b));
  return Buffer.concat(parts);
}

test('the phrase opens what was sealed to it; spacing and case do not matter', async () => {
  const { publicRaw } = keysFromPhrase(PHRASE);
  const data = Buffer.alloc(2_500_000, 7); data.write('hello', 0);
  const sealed = await seal(data, publicRaw);
  assert.deepEqual(openSealed(sealed, keysFromPhrase(PHRASE.toLowerCase().replace(/-/g, ' ')).privateKey), data);
  assert.equal(normalizePhrase('k7qf 2m9x'), 'K7QF2M9X');
});

test('a wrong phrase, a changed byte, a cut-short file or an extra tail all refuse to open', async () => {
  const { publicRaw, privateKey } = keysFromPhrase(PHRASE);
  const data = Buffer.alloc(2_500_000, 3);
  const sealed = await seal(data, publicRaw);
  assert.throws(() => openSealed(sealed, keysFromPhrase('WRONG-PHRASE').privateKey), /does not open/);
  const flipped = Buffer.from(sealed); flipped[sealed.length - 40] ^= 1;
  assert.throws(() => openSealed(flipped, privateKey));
  assert.throws(() => openSealed(sealed.subarray(0, sealed.length - 100), privateKey), /cut short/);
  // Drop the whole last chunk: what is left ends on a chunk not marked final.
  const firstChunkEnd = 8 + 32 + 16 + 4 + 12 + sealed.readUInt32BE(56) + 16;
  assert.throws(() => openSealed(sealed.subarray(0, firstChunkEnd), privateKey), /changed|cut short|does not open/);
  assert.throws(() => openSealed(Buffer.concat([sealed, sealed.subarray(56)]), privateKey));
});

test('the nightly backup is a whole database with the logins left out, and only the newest are kept', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealed-'));
  try {
    const db = new Database(join(dir, 'live.db'));
    db.exec("CREATE TABLE messages (t TEXT); INSERT INTO messages VALUES ('every word'); CREATE TABLE web_sessions (token TEXT); INSERT INTO web_sessions VALUES ('live-login');");
    const { publicRaw, privateKey } = keysFromPhrase(PHRASE);
    const out = join(dir, 'out');
    for (let i = 0; i < 3; i++) await makeSealedBackup({ db, publicKeyRaw: publicRaw, dir: out, keep: 2, now: new Date(Date.UTC(2026, 10, 20, i)) });
    const list = listSealedBackups(out);
    assert.equal(list.length, 2);
    const opened = gunzipSync(openSealed(readFileSync(join(out, list[0].name)), privateKey));
    const restored = join(dir, 'restored.db'); writeFileSync(restored, opened);
    assert.ok(!opened.includes(Buffer.from('live-login')), 'the login is gone from the file, not just from the table');
    const r = new Database(restored, { readonly: true });
    assert.equal((r.prepare('SELECT t FROM messages').get() as { t: string }).t, 'every word');
    assert.equal((r.prepare('SELECT count(*) AS n FROM web_sessions').get() as { n: number }).n, 0);
    r.close(); db.close();
    assert.ok(!readFileSync(join(out, list[0].name)).includes(Buffer.from('every word')), 'nothing readable in the sealed file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the laptop app turns a phrase into the same key the house seals to', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const laptop = createRequire(import.meta.url)(join(here, '..', '..', '..', '..', 'desktop', 'backup-key.cjs')) as {
    newPhrase(): string; normalizePhrase(p: string): string; publicKeyFromPhrase(p: string): Buffer;
  };
  const phrase = laptop.newPhrase();
  assert.match(phrase, /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.deepEqual(laptop.publicKeyFromPhrase(phrase), keysFromPhrase(phrase).publicRaw);
  // Misread on paper: O for 0, I or L for 1, lower case, spaces.
  const scribbled = 'k7qf 2m9x pl4d 88wz qh3t rn6v b2cy j5sa'.replace(/1/g, 'l');
  for (const p of ['OO1L', 'o0il', scribbled]) assert.equal(laptop.normalizePhrase(p), normalizePhrase(p));
  assert.deepEqual(keysFromPhrase('OOIL-K7QF').publicRaw, keysFromPhrase('001-1k7qf').publicRaw);
});
