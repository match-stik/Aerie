// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The files half of the sealed backup (Nov 24 2026: the laptop keeps a
// copy of everything, only new files crossing each time). The nightly sealed
// backup holds the database; the uploads (data/files) and the painted pictures
// (data/generated-images) can run to many gigabytes, so they are not packed into
// one file. The house lists them, and seals each one on the way out with the
// same public key the database backup uses; the laptop keeps one sealed file
// per file and only fetches what it does not already have. Nothing sealed is
// stored on the house, so the copy costs it no disk.

import { createReadStream, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { publicKeyFromRaw, sealStream } from './sealed-backup.js';

/** The folders that cross, each under a short name the laptop files them by. */
export const FILE_ROOTS: ReadonlyArray<{ name: string; dir: string }> = [
  { name: 'files', dir: join('data', 'files') },
  { name: 'generated-images', dir: join('data', 'generated-images') },
];

export interface BackupFileEntry { path: string; bytes: number; mtime: number }

/** Every regular file under the roots, by its name/relative path. No links, nothing dot-hidden. */
export function listBackupFiles(projectRoot: string): BackupFileEntry[] {
  const out: BackupFileEntry[] = [];
  for (const root of FILE_ROOTS) {
    const base = join(projectRoot, root.dir);
    const walk = (dir: string, rel: string) => {
      let names: string[];
      try { names = readdirSync(dir); } catch { return; }
      for (const name of names) {
        if (name.startsWith('.')) continue;
        const abs = join(dir, name);
        let st;
        try { st = lstatSync(abs); } catch { continue; }
        if (st.isSymbolicLink()) continue;
        const relPath = rel ? `${rel}/${name}` : name;
        if (st.isDirectory()) walk(abs, relPath);
        else if (st.isFile()) out.push({ path: `${root.name}/${relPath}`, bytes: st.size, mtime: Math.floor(st.mtimeMs) });
      }
    };
    walk(base, '');
  }
  return out;
}

/**
 * The file on disk a manifest path names, or null: it must sit under one of
 * the roots after links are followed, with no climbing out and nothing hidden.
 */
export function resolveBackupFile(projectRoot: string, path: unknown): string | null {
  if (typeof path !== 'string' || !path || path.includes('\0')) return null;
  const parts = path.split('/');
  const root = FILE_ROOTS.find((r) => r.name === parts[0]);
  if (!root || parts.length < 2) return null;
  if (parts.slice(1).some((p) => !p || p === '.' || p === '..' || p.startsWith('.'))) return null;
  const base = resolve(projectRoot, root.dir);
  const abs = resolve(base, ...parts.slice(1));
  try {
    const st = lstatSync(abs);
    if (!st.isFile() || st.isSymbolicLink()) return null;
    const real = realpathSync(abs);
    const realBase = realpathSync(base);
    return real.startsWith(realBase + sep) ? real : null;
  } catch {
    return null;
  }
}

/** Seal one file (gzipped, the same format the database backup uses) into write. */
export async function sealFile(abs: string, publicKeyRaw: Buffer, write: (b: Buffer) => void): Promise<void> {
  await sealStream(createReadStream(abs).pipe(createGzip({ level: 1 })) as AsyncIterable<Buffer>, publicKeyFromRaw(publicKeyRaw), write);
}
