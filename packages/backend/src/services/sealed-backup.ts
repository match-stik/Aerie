// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A nightly backup the house can make and cannot open.
//
// The person's laptop app turns a recovery phrase into a key pair on the
// laptop itself and hands the house only the public half (backup.public_key).
// Once a night the house takes a consistent copy of the database with
// SQLite's online backup, leaves the login sessions out of it, compresses it,
// and seals it to that public key. Nothing on the server can open the result,
// including anything that breaks into the server: opening it needs the
// phrase, which is written down and never typed into the house.
//
// The file is sealed in chunks, each authenticated with its position and
// whether it is the last, so a tampered, reordered or cut-short file fails
// loudly when opened instead of restoring half a house. Pictures and uploaded
// files are not in it; they are big, and the server's own whole-disk backups
// carry them. Opening one is tools/backup/open-backup.mjs, run by hand.

import {
  createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman,
  generateKeyPairSync, hkdfSync, randomBytes, scryptSync, type KeyObject,
} from 'node:crypto';
import { createGzip } from 'node:zlib';
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { isSealedValue, loadSecretsKey, openValue } from './secret-box.js';

export const MAGIC = Buffer.from('AERIEBK1');
const INFO = Buffer.from('aerie-backup-v1');
export const CHUNK = 1024 * 1024;
/** The phrase is stretched with this salt; changing it would orphan every phrase. */
export const PHRASE_SALT = 'aerie-backup-key-v1';

// ── keys ────────────────────────────────────────────────────────────────────

const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');

/**
 * Spaces, dashes and case do not matter when typing the phrase back in, and
 * neither do the letters a hand-written 0 or 1 gets misread as: phrases are
 * made from Crockford's alphabet, which has no I, L, O or U, so O reads as 0
 * and I or L as 1. The laptop app does the same (desktop/backup-key.cjs), and
 * a test holds the two together.
 */
export function normalizePhrase(phrase: string): string {
  return phrase.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** The private key a phrase stands for (X25519), and its public half as 32 raw bytes. */
export function keysFromPhrase(phrase: string): { privateKey: KeyObject; publicRaw: Buffer } {
  const seed = scryptSync(normalizePhrase(phrase), PHRASE_SALT, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_X25519, seed]), format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer;
  return { privateKey, publicRaw: spki.subarray(spki.length - 32) };
}

export function publicKeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== 32) throw new Error('A backup public key is 32 bytes.');
  return createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: 'der', type: 'spki' });
}

function aad(index: number, final: boolean): Buffer {
  const b = Buffer.alloc(MAGIC.length + 9);
  MAGIC.copy(b, 0);
  b.writeBigUInt64BE(BigInt(index), MAGIC.length);
  b[MAGIC.length + 8] = final ? 1 : 0;
  return b;
}

// ── sealing ─────────────────────────────────────────────────────────────────

/**
 * Seal a stream of bytes to a public key. Header: magic, the one-off public
 * key, a salt. Then chunks: length (4 bytes), iv (12), ciphertext, tag (16);
 * the last chunk is marked final inside its authentication.
 */
export async function sealStream(input: AsyncIterable<Buffer>, recipient: KeyObject, write: (b: Buffer) => void): Promise<void> {
  const eph = generateKeyPairSync('x25519');
  const ephSpki = eph.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const salt = randomBytes(16);
  const key = Buffer.from(hkdfSync('sha256', diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), salt, INFO, 32));
  write(Buffer.concat([MAGIC, ephSpki.subarray(ephSpki.length - 32), salt]));
  let pending = Buffer.alloc(0);
  let index = 0;
  const emit = (plain: Buffer, final: boolean) => {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(aad(index++, final));
    const ct = Buffer.concat([c.update(plain), c.final()]);
    const len = Buffer.alloc(4); len.writeUInt32BE(ct.length, 0);
    write(Buffer.concat([len, iv, ct, c.getAuthTag()]));
  };
  for await (const piece of input) {
    pending = Buffer.concat([pending, piece]);
    while (pending.length > CHUNK) { emit(pending.subarray(0, CHUNK), false); pending = pending.subarray(CHUNK); }
  }
  emit(pending, true);
}

/** Open a sealed file with the phrase's private key. Throws on any tampering, truncation or wrong phrase. */
export function openSealed(sealed: Buffer, privateKey: KeyObject): Buffer {
  if (sealed.length < MAGIC.length + 48 || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an Aerie backup.');
  let at = MAGIC.length;
  const ephPub = publicKeyFromRaw(sealed.subarray(at, at + 32)); at += 32;
  const salt = sealed.subarray(at, at + 16); at += 16;
  const key = Buffer.from(hkdfSync('sha256', diffieHellman({ privateKey, publicKey: ephPub }), salt, INFO, 32));
  const out: Buffer[] = [];
  let index = 0;
  let sawFinal = false;
  while (at < sealed.length) {
    if (sawFinal) throw new Error('This backup has data after its end; it has been tampered with.');
    if (at + 4 + 12 + 16 > sealed.length) throw new Error('This backup is cut short.');
    const len = sealed.readUInt32BE(at); at += 4;
    const iv = sealed.subarray(at, at + 12); at += 12;
    if (at + len + 16 > sealed.length) throw new Error('This backup is cut short.');
    const ct = sealed.subarray(at, at + len); at += len;
    const tag = sealed.subarray(at, at + 16); at += 16;
    const final = at === sealed.length;
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(aad(index++, final));
    d.setAuthTag(tag);
    try {
      out.push(Buffer.concat([d.update(ct), d.final()]));
    } catch {
      throw new Error(index === 1 ? 'This backup does not open with that phrase (or it has been changed).' : 'This backup has been changed or cut short.');
    }
    sawFinal = final;
  }
  if (!sawFinal) throw new Error('This backup is cut short.');
  return Buffer.concat(out);
}

// ── the nightly backup ──────────────────────────────────────────────────────

/** Tables that hold live logins: never put in a backup. */
export const LEFT_OUT_TABLES = ['web_sessions'];

export interface BackupResult { file: string; bytes: number; at: string }

/**
 * Take a consistent copy of the live database, leave the logins out,
 * compress and seal it into dir, keep only the newest `keep`, and say which
 * file it made. The plain copy only ever exists for the moments it takes to
 * compress it, inside dir, and is removed whatever happens.
 */
export async function makeSealedBackup(opts: { db: Database.Database; publicKeyRaw: Buffer; dir: string; keep?: number; now?: Date }): Promise<BackupResult> {
  const { db, dir } = opts;
  const keep = Math.max(1, opts.keep ?? 2);
  const recipient = publicKeyFromRaw(opts.publicKeyRaw);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const at = (opts.now ?? new Date()).toISOString();
  const stamp = at.replace(/[:.]/g, '-');
  const plain = join(dir, `.copy-${stamp}.db`);
  const final = join(dir, `aerie-backup-${stamp}.sealed`);
  const temp = `${final}.part`;
  try {
    await db.backup(plain);
    const copy = new Database(plain);
    try {
      // secure_delete zeroes the deleted rows where they lie, so the logins
      // are gone from the file without a VACUUM, which on a database this
      // size would hold the whole house still for seconds (better-sqlite3
      // runs on the main thread).
      copy.pragma('secure_delete = ON');
      for (const t of LEFT_OUT_TABLES) {
        const exists = copy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
        if (exists) copy.prepare(`DELETE FROM ${t}`).run();
      }
      // The keys go into the backup opened (it is sealed to the phrase
      // anyway), so a restore never depends on the house's key file
      // surviving whatever took the house down.
      const secretsKey = loadSecretsKey();
      const hasConfig = copy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='config'").get();
      const rows = (hasConfig ? copy.prepare("SELECT key, value FROM config WHERE key LIKE 'secret:%'").all() : []) as Array<{ key: string; value: string }>;
      for (const r of rows) {
        if (!isSealedValue(r.value)) continue;
        const plain = openValue(r.value, secretsKey, r.key);
        if (plain !== null) copy.prepare('UPDATE config SET value = ? WHERE key = ?').run(plain, r.key);
      }
      copy.pragma('journal_mode = DELETE');
    } finally {
      copy.close();
    }
    const fd = openSync(temp, 'w', 0o600);
    try {
      await sealStream(createReadStream(plain).pipe(createGzip({ level: 6 })) as AsyncIterable<Buffer>, recipient, (b) => { writeSync(fd, b); });
    } finally {
      closeSync(fd);
    }
    renameSync(temp, final);
  } finally {
    rmSync(plain, { force: true });
    rmSync(`${plain}-journal`, { force: true });
    rmSync(temp, { force: true });
  }
  for (const old of listSealedBackups(dir).slice(keep)) rmSync(join(dir, old.name), { force: true });
  return { file: final, bytes: statSync(final).size, at };
}

/** The sealed backups in dir, newest first. */
export function listSealedBackups(dir: string): Array<{ name: string; bytes: number; at: number }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^aerie-backup-.*\.sealed$/.test(n))
    .map((name) => { const s = statSync(join(dir, name)); return { name, bytes: s.size, at: s.mtimeMs }; })
    .sort((a, b) => b.at - a.at);
}
