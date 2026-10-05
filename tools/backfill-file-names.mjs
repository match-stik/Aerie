#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Give the Files app back the names the user gave their files.
 *
 * Files are stored as <uuid><ext> with no table behind them, so every save
 * took an originalFilename, returned it in the message metadata, and threw it
 * away. The sidecar shipped Sep 3 2026 and only covers files saved since.
 * Everything older — nearly four thousand of them — lists as bare hex.
 *
 * The names are not gone: every file that ever rode in a message has its
 * filename sitting in that message's attachments JSON. This walks those and
 * writes the sidecar the old save path never wrote.
 *
 * It deliberately skips generic camera names (see isGenericUploadName). Of the
 * 3,077 recoverable names, 2,626 are the literal string "image.jpg", and a
 * column of identical words is harder to read than a column of distinct hex.
 *
 * Idempotent: an existing sidecar is never overwritten. Pass --dry to count
 * without writing.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES_DIR = join(root, 'data', 'files');
const DB_PATH = join(root, 'data', 'aerie.db');
const SIDECAR_EXT = '.name';
const dry = process.argv.includes('--dry');

// Kept in step with packages/backend/src/services/file-names.ts. Duplicated
// rather than imported because that is TypeScript behind a build, and a
// one-shot repair should not depend on dist/ being current.
const safeDisplayName = (raw) =>
  typeof raw === 'string'
    ? (raw.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120)
    : '';
const isGenericUploadName = (raw) => {
  const safe = safeDisplayName(raw).toLowerCase();
  if (!safe) return true;
  return /^(image|img|photo|video|file|document|unnamed|untitled)\.[a-z0-9]{1,5}$/.test(safe);
};

const onDisk = new Set();
for (const entry of readdirSync(FILES_DIR)) {
  const m = entry.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.\w+)$/i);
  if (m && m[2].toLowerCase() !== SIDECAR_EXT) onDisk.add(m[1]);
}

const db = new Database(DB_PATH, { readonly: true });
const rows = db.prepare(
  "select metadata from messages where metadata is not null and metadata like '%attachments%'",
).all();
db.close();

const counts = { rows: 0, named: 0, generic: 0, selfNamed: 0, absent: 0, already: 0, written: 0 };
const chosen = new Map();

for (const row of rows) {
  let attachments;
  try {
    attachments = JSON.parse(row.metadata)?.attachments;
  } catch {
    continue;
  }
  if (!Array.isArray(attachments)) continue;
  for (const att of attachments) {
    counts.rows++;
    const fileId = att?.fileId;
    if (typeof fileId !== 'string' || !onDisk.has(fileId)) {
      counts.absent++;
      continue;
    }
    if (isGenericUploadName(att?.filename)) {
      counts.generic++;
      continue;
    }
    // A great many attachments recorded the file's own storage name — the uuid
    // it was already listed under. That is not a name the user gave anything, and
    // writing it into a sidecar would make the app show exactly what it shows
    // now while claiming to have remembered something.
    if (safeDisplayName(att.filename).startsWith(fileId)) {
      counts.selfNamed++;
      continue;
    }
    counts.named++;
    // First informative name wins; a later message re-attaching the same file
    // does not get to rename it underneath the user.
    if (!chosen.has(fileId)) chosen.set(fileId, safeDisplayName(att.filename));
  }
}

for (const [fileId, name] of chosen) {
  const sidecar = join(FILES_DIR, `${fileId}${SIDECAR_EXT}`);
  if (existsSync(sidecar)) {
    counts.already++;
    continue;
  }
  if (!dry) writeFileSync(sidecar, name, 'utf8');
  counts.written++;
}

console.log(
  `${dry ? '[dry] ' : ''}attachments seen ${counts.rows}` +
    ` · informative ${counts.named} · generic skipped ${counts.generic}` +
    ` · uuid-as-name skipped ${counts.selfNamed}` +
    ` · file gone ${counts.absent} · already named ${counts.already}` +
    ` · sidecars written ${counts.written}`,
);
