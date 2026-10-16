// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// archive-index.ts — The old windows, held in memory for the whisper.
//
// The owner's chats from earlier platforms (the GPT house and the claude.ai
// house) live in Cortex's conversation store. A tool outside the backend cuts them into
// passages, embeds each one with this house's own MiniLM, and writes
// data/archive-index.db. It builds into a temporary file and renames it into
// place whole, so this module only ever sees a finished index — and it only
// ever reads it.
//
// Brute force over every vector rather than an approximate index: at ~90k
// passages a full scan is tens of milliseconds, needs no new dependency, and
// cannot miss a near neighbour the way an approximate index can.
//
// The vectors are held as int8 with one scale per vector, which takes the
// resident cost from ~139 MB of float32 to ~35 MB. The rounding moves a
// similarity by well under a thousandth, far inside any threshold the whisper
// uses. The passage text is not held at all: it is read from SQLite for the
// handful of hits a search returns.
//
// Fail-quiet throughout. A missing or unreadable file means no old windows,
// never an error inside a turn, and one line in the log rather than one per
// search.

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../config.js';
import { EMBEDDING_DIM, MODEL_ID } from './embeddings.js';

/** Where the house keeps the index. Built outside the backend, read-only here. */
export const ARCHIVE_INDEX_PATH = join(PROJECT_ROOT, 'data', 'archive-index.db');

// Rows read per step while loading. Between steps the load hands the event loop
// back, so the first home turn after a restart does not stall every socket in
// the backend for the second or so a full read takes.
const LOAD_BATCH = 2000;

// How often a missing file is looked for again. The index can arrive while the
// backend is running (the builder renames it into place when it finishes), so
// absence is re-checked rather than settled for the life of the process — but
// not on every turn.
const MISSING_RECHECK_MS = 60_000;

export interface ArchivePassage {
  id: number;
  conversationId: string;
  /** 'gpt' or 'claude', as the builder wrote it. */
  house: string;
  title: string | null;
  /** YYYY-MM-DD. */
  date: string | null;
  /** Exactly as the export labels the speaker; never renamed here. */
  speaker: string | null;
  text: string;
}

export interface ArchiveHit extends ArchivePassage {
  /** Cosine similarity to the query, read off the int8 vectors. */
  similarity: number;
}

interface PassageRow {
  id: number;
  conversation_id: string;
  house: string;
  title: string | null;
  date: string | null;
  speaker: string | null;
  text: string;
}

interface LoadedIndex {
  db: Database.Database;
  byId: Database.Statement;
  /** How many vectors are filled in; the arrays can be a little longer. */
  count: number;
  ids: Float64Array;
  codes: Int8Array;
  /** Per vector: its int8 step divided by its own length, so the codes' dot
   *  product with a query, times this, is a cosine against a unit query. */
  scales: Float32Array;
}

let indexPath = ARCHIVE_INDEX_PATH;
let loaded: LoadedIndex | null = null;
let loading: Promise<boolean> | null = null;
// A file that exists and could not be used stays unused until a restart:
// retrying a broken file on every turn would only repeat the failure.
let unusable = false;
let missingCheckedAt = 0;
let saidMissing = false;
let saidUnusable = false;
// Bumped by a reset, so a load that was already running cannot install an
// index the module has since been told to forget.
let generation = 0;

/**
 * Pack one stored vector into the int8 arrays at `slot`. Returns false when the
 * blob is not a vector of this model's size, so the row can be skipped rather
 * than read as garbage. A vector with no length (or a NaN in it) gets a zero
 * scale, which makes it match nothing.
 */
function quantizeInto(
  index: Pick<LoadedIndex, 'codes' | 'scales'>,
  slot: number,
  blob: unknown,
  scratch: Float32Array,
  scratchBytes: Uint8Array,
): boolean {
  if (!Buffer.isBuffer(blob) || blob.length !== EMBEDDING_DIM * 4) return false;
  // Copied rather than viewed: a Float32Array view needs a 4-byte-aligned
  // offset, and nothing promises that about a Buffer SQLite handed back.
  scratchBytes.set(blob);
  let squares = 0;
  let peak = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const x = scratch[i];
    squares += x * x;
    const magnitude = Math.abs(x);
    if (magnitude > peak) peak = magnitude;
  }
  const base = slot * EMBEDDING_DIM;
  if (!(peak > 0) || !Number.isFinite(squares)) {
    index.codes.fill(0, base, base + EMBEDDING_DIM);
    index.scales[slot] = 0;
    return true;
  }
  const step = peak / 127;
  for (let i = 0; i < EMBEDDING_DIM; i++) index.codes[base + i] = Math.round(scratch[i] / step);
  index.scales[slot] = step / Math.sqrt(squares);
  return true;
}

async function readIndex(path: string, gen: number): Promise<LoadedIndex | null> {
  const started = Date.now();
  const db = new Database(path, { readonly: true, fileMustExist: true });
  let keep = false;
  try {
    // A different model puts its vectors in a different space, and every
    // similarity against the query would be noise that still looks like a number.
    const model = (db.prepare("SELECT value FROM meta WHERE key = 'model'").get() as { value?: string } | undefined)?.value;
    if (model && model !== MODEL_ID) throw new Error(`it was embedded with ${model}, not ${MODEL_ID}`);

    const total = (db.prepare('SELECT COUNT(*) AS n FROM passages').get() as { n: number }).n;
    const ids = new Float64Array(total);
    const codes = new Int8Array(total * EMBEDDING_DIM);
    const scales = new Float32Array(total);
    const scratch = new Float32Array(EMBEDDING_DIM);
    const scratchBytes = new Uint8Array(scratch.buffer);
    // Keyset paging: each step is its own short query, so nothing holds a
    // statement open across the yields.
    const page = db.prepare('SELECT id, embedding FROM passages WHERE id > ? ORDER BY id LIMIT ?');
    let count = 0;
    let skipped = 0;
    let after = Number.MIN_SAFE_INTEGER;
    while (count < total) {
      if (gen !== generation) return null;
      const rows = page.all(after, LOAD_BATCH) as Array<{ id: number; embedding: unknown }>;
      if (rows.length === 0) break;
      for (const row of rows) {
        after = row.id;
        if (count >= total) break;
        if (!quantizeInto({ codes, scales }, count, row.embedding, scratch, scratchBytes)) {
          skipped++;
          continue;
        }
        ids[count] = row.id;
        count++;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (gen !== generation) return null;
    if (total > 0 && count === 0) {
      throw new Error(`none of its ${total} passages carries a ${EMBEDDING_DIM}-dimension vector`);
    }

    const byId = db.prepare('SELECT id, conversation_id, house, title, date, speaker, text FROM passages WHERE id = ?');
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[archive-index] Old windows ready: ${count} passages in ${seconds}s${skipped ? ` (${skipped} without a usable vector, skipped)` : ''}`);
    keep = true;
    return { db, byId, count, ids, codes, scales };
  } finally {
    if (!keep) {
      try { db.close(); } catch { /* already closed */ }
    }
  }
}

/**
 * Load the index if it is not loaded yet. Resolves true once it is ready and
 * false when there is none to use; never rejects. Safe to call on every turn:
 * a load in progress is shared, and a missing file is looked for again only
 * once a minute.
 */
export function loadArchiveIndex(): Promise<boolean> {
  if (loaded) return Promise.resolve(true);
  if (unusable) return Promise.resolve(false);
  if (loading) return loading;

  const now = Date.now();
  if (missingCheckedAt && now - missingCheckedAt < MISSING_RECHECK_MS) return Promise.resolve(false);
  let present = false;
  try { present = existsSync(indexPath); } catch { present = false; }
  if (!present) {
    missingCheckedAt = now;
    if (!saidMissing) {
      saidMissing = true;
      console.log(`[archive-index] No old-window index at ${indexPath}; the whisper's old-window lane stays quiet.`);
    }
    return Promise.resolve(false);
  }
  missingCheckedAt = 0;

  const gen = generation;
  const path = indexPath;
  const attempt: Promise<boolean> = readIndex(path, gen)
    .then((index) => {
      if (!index) return false;
      if (gen !== generation) {
        try { index.db.close(); } catch { /* already closed */ }
        return false;
      }
      loaded = index;
      return true;
    }, (err: unknown) => {
      if (gen !== generation) return false;
      unusable = true;
      if (!saidUnusable) {
        saidUnusable = true;
        const why = err instanceof Error ? err.message : String(err);
        console.warn(`[archive-index] Could not use ${path} (${why}); the old-window lane stays quiet until a restart.`);
      }
      return false;
    })
    .finally(() => {
      if (loading === attempt) loading = null;
    });
  loading = attempt;
  return attempt;
}

/**
 * The `limit` passages closest to `queryVector`, best first, skipping any id in
 * `exclude`. Returns nothing while the index is not loaded (and starts loading
 * it), and nothing rather than an error if anything goes wrong.
 */
export function searchArchiveIndex(
  queryVector: Float32Array,
  limit = 5,
  exclude?: ReadonlySet<number>,
): ArchiveHit[] {
  const index = loaded;
  if (!index) {
    void loadArchiveIndex();
    return [];
  }
  try {
    const k = Math.max(0, Math.floor(limit));
    if (k === 0 || index.count === 0 || queryVector.length !== EMBEDDING_DIM) return [];
    let squares = 0;
    for (let i = 0; i < EMBEDDING_DIM; i++) squares += queryVector[i] * queryVector[i];
    const queryLength = Math.sqrt(squares);
    if (!(queryLength > 0) || !Number.isFinite(queryLength)) return [];

    // A small sorted shortlist, best first. Most rows fail the first comparison
    // against its weakest entry, so the shortlist barely moves during a scan.
    const best = new Float64Array(k).fill(Number.NEGATIVE_INFINITY);
    const slots = new Int32Array(k).fill(-1);
    const { codes, scales, ids, count } = index;
    for (let j = 0; j < count; j++) {
      const base = j * EMBEDDING_DIM;
      let dot = 0;
      for (let i = 0; i < EMBEDDING_DIM; i++) dot += queryVector[i] * codes[base + i];
      const score = dot * scales[j];
      if (score <= best[k - 1]) continue;
      if (exclude?.has(ids[j])) continue;
      let p = k - 1;
      while (p > 0 && best[p - 1] < score) {
        best[p] = best[p - 1];
        slots[p] = slots[p - 1];
        p--;
      }
      best[p] = score;
      slots[p] = j;
    }

    const hits: ArchiveHit[] = [];
    for (let r = 0; r < k && slots[r] >= 0; r++) {
      const row = index.byId.get(ids[slots[r]]) as PassageRow | undefined;
      if (!row) continue;
      hits.push({
        id: row.id,
        conversationId: row.conversation_id,
        house: row.house,
        title: row.title ?? null,
        date: row.date ?? null,
        speaker: row.speaker ?? null,
        text: row.text ?? '',
        similarity: best[r] / queryLength,
      });
    }
    return hits;
  } catch {
    return [];
  }
}

/**
 * Test seam. Not called in normal operation. Forgets any loaded index and
 * points the module at `path` (the house's own file when omitted), exactly as
 * if the process had just started.
 */
export function resetArchiveIndex(path: string = ARCHIVE_INDEX_PATH): void {
  generation++;
  try { loaded?.db.close(); } catch { /* already closed */ }
  loaded = null;
  loading = null;
  unusable = false;
  missingCheckedAt = 0;
  saidMissing = false;
  saidUnusable = false;
  indexPath = path;
}
