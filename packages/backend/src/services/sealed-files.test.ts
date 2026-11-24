// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The files half of the sealed backup: the list, the guard on what may be
// asked for, and a sealed file that opens back to the same bytes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { keysFromPhrase, openSealed } from './sealed-backup.js';
import { listBackupFiles, resolveBackupFile, sealFile } from './sealed-files.js';

const root = mkdtempSync(join(tmpdir(), 'aerie-files-'));
const outside = mkdtempSync(join(tmpdir(), 'aerie-not-'));
mkdirSync(join(root, 'data', 'files'), { recursive: true });
mkdirSync(join(root, 'data', 'generated-images', '2026'), { recursive: true });
writeFileSync(join(root, 'data', 'files', 'photo.jpg'), Buffer.from('a photo'));
writeFileSync(join(root, 'data', 'files', '.hidden'), 'no');
writeFileSync(join(root, 'data', 'generated-images', '2026', 'us.png'), Buffer.from('a painting of us'));
writeFileSync(join(outside, 'secret.txt'), 'not for the backup');
symlinkSync(join(outside, 'secret.txt'), join(root, 'data', 'files', 'link.txt'));
writeFileSync(join(root, 'aerie.yaml'), 'password');

test('the list holds the uploads and the pictures, nothing hidden and no links', () => {
  const paths = listBackupFiles(root).map((f) => f.path).sort();
  assert.deepEqual(paths, ['files/photo.jpg', 'generated-images/2026/us.png']);
});

test('only a listed kind of file can be asked for (Nov 24 2026)', () => {
  assert.ok(resolveBackupFile(root, 'files/photo.jpg'));
  assert.ok(resolveBackupFile(root, 'generated-images/2026/us.png'));
  for (const bad of ['files/../../aerie.yaml', 'files/.hidden', 'files/link.txt', 'data/aerie.db', '../aerie.yaml', 'files', '', null]) {
    assert.equal(resolveBackupFile(root, bad), null, String(bad));
  }
});

test('a sealed file opens with the phrase back to the same bytes', async () => {
  const phrase = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789';
  const { publicRaw, privateKey } = keysFromPhrase(phrase);
  const chunks: Buffer[] = [];
  await sealFile(resolveBackupFile(root, 'files/photo.jpg')!, publicRaw, (b) => chunks.push(b));
  const sealed = Buffer.concat(chunks);
  assert.ok(!sealed.includes(Buffer.from('a photo')), 'nothing readable in the sealed copy');
  assert.equal(gunzipSync(openSealed(sealed, privateKey)).toString(), 'a photo');
});

test('the laptop fetches only what it lacks, a bounded amount at a time, and writes nothing outside its folder', async () => {
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const here = fileURLToPath(new URL('.', import.meta.url));
  const laptop = createRequire(import.meta.url)(join(here, '..', '..', '..', '..', 'desktop', 'file-backup.cjs')) as {
    safeRelPath(p: unknown): string[] | null;
    planFetch(m: unknown, i: Record<string, { bytes: number; mtime: number }>, b?: { bytes: number; files: number }): { take: Array<{ path: string }>; missing: number };
  };
  const manifest = [
    { path: 'files/a.jpg', bytes: 10, mtime: 1 },
    { path: 'files/b.jpg', bytes: 10, mtime: 2 },
    { path: 'generated-images/c.png', bytes: 10, mtime: 3 },
    { path: 'files/../../evil', bytes: 1, mtime: 0 },
    { path: 'C:/Windows/x', bytes: 1, mtime: 0 },
  ];
  const plan = laptop.planFetch(manifest, { 'files/a.jpg': { bytes: 10, mtime: 1 } }, { bytes: 15, files: 10 });
  assert.deepEqual(plan.take.map((f) => f.path), ['files/b.jpg'], 'already had a, budget stops after b');
  assert.equal(plan.missing, 2);
  assert.equal(laptop.safeRelPath('files/../../evil'), null);
  assert.equal(laptop.safeRelPath('files/a:b.jpg'), null);
  assert.deepEqual(laptop.safeRelPath('generated-images/2026/us.png'), ['generated-images', '2026', 'us.png']);
  const changed = laptop.planFetch(manifest, { 'files/a.jpg': { bytes: 9, mtime: 1 } });
  assert.ok(changed.take.some((f) => f.path === 'files/a.jpg'), 'a changed file is fetched again');
});
