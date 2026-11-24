// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The files half of the backup, on the laptop (Nov 24 2026). The house
// lists its uploads and pictures (GET /api/backup/files) and seals each one
// as it hands it over (GET /api/backup/files/item), to the same key the
// database backup uses. This side keeps one sealed file per file under
// Documents\Aerie Backups\files, remembers what it has in index.json, and on
// each run fetches only what is new or changed, a bounded amount at a time so
// the first big copy spreads over several runs. Nothing is ever deleted here
// when the house deletes it: a backup that forgets is not a backup.
// No Electron in here, so the backend's test can load it.

/** A manifest path this side will write: a known root, plain names, no climbing. */
function safeRelPath(p) {
  if (typeof p !== 'string' || !/^(files|generated-images)\//.test(p)) return null;
  const parts = p.split('/');
  if (parts.some((x) => !x || x === '.' || x === '..' || x.startsWith('.') || /[\\:*?"<>|\0]/.test(x))) return null;
  return parts;
}

/**
 * Which files to fetch this run: the ones missing or changed since the index
 * last saw them, oldest first, until the byte or count budget is spent (at
 * least one, so a single large file still gets through).
 */
function planFetch(manifest, index, budget = { bytes: 2 * 1024 ** 3, files: 1500 }) {
  const want = [];
  let missing = 0;
  for (const f of Array.isArray(manifest) ? manifest : []) {
    if (!f || !safeRelPath(f.path) || typeof f.bytes !== 'number' || typeof f.mtime !== 'number') continue;
    const had = index[f.path];
    if (had && had.bytes === f.bytes && had.mtime === f.mtime) continue;
    missing++;
    want.push(f);
  }
  want.sort((a, b) => a.mtime - b.mtime);
  const take = [];
  let bytes = 0;
  for (const f of want) {
    if (take.length && (bytes + f.bytes > budget.bytes || take.length >= budget.files)) break;
    take.push(f);
    bytes += f.bytes;
  }
  return { take, missing };
}

module.exports = { safeRelPath, planFetch };
