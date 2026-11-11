// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import Database from 'better-sqlite3';
import { EMBEDDING_DIM, MODEL_ID, vectorToBuffer } from './embeddings.js';
import { loadArchiveIndex, resetArchiveIndex, searchArchiveIndex } from './archive-index.js';

const dir = mkdtempSync(join(tmpdir(), 'archive-index-test-'));
after(() => {
  resetArchiveIndex(); // closes the open handle before its file goes
  rmSync(dir, { recursive: true, force: true });
});

interface Passage {
  conversationId: string;
  house: string;
  title: string;
  date: string;
  speaker: string;
  text: string;
  vector: Float32Array;
}

/** Same schema the builder writes (~/tools/archive-import/build_index.mjs). */
function writeIndex(path: string, passages: Passage[], model: string | null = MODEL_ID): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE passages (
      id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL, house TEXT NOT NULL, title TEXT,
      date TEXT, speaker TEXT, text TEXT NOT NULL, embedding BLOB NOT NULL
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  const insert = db.prepare('INSERT INTO passages (conversation_id, house, title, date, speaker, text, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const p of passages) insert.run(p.conversationId, p.house, p.title, p.date, p.speaker, p.text, vectorToBuffer(p.vector));
  if (model) db.prepare("INSERT INTO meta (key, value) VALUES ('model', ?)").run(model);
  db.close();
}

// Seeded, so a failure reproduces exactly.
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unitVector(next: () => number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  let squares = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    v[i] = next() * 2 - 1;
    squares += v[i] * v[i];
  }
  const length = Math.sqrt(squares);
  for (let i = 0; i < EMBEDDING_DIM; i++) v[i] /= length;
  return v;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / Math.sqrt(aa * bb);
}

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  console.warn = (...args: unknown[]) => { lines.push(args.join(' ')); };
  console.error = (...args: unknown[]) => { lines.push(args.join(' ')); };
  return { lines, restore: () => Object.assign(console, original) };
}

test('finds the closest passages by cosine from int8 vectors, with their metadata', async () => {
  const next = random(20261001);
  const passages: Passage[] = Array.from({ length: 60 }, (_, i) => ({
    conversationId: `conv-${i}`,
    house: i % 2 ? 'claude' : 'gpt',
    title: `window ${i}`,
    date: `2025-10-${String((i % 28) + 1).padStart(2, '0')}`,
    speaker: i % 3 ? 'Claude' : 'Owner',
    text: `synthetic passage ${i}`,
    vector: unitVector(next),
  }));
  // The query sits near passage 17 so the winner is never a near-tie.
  const query = new Float32Array(EMBEDDING_DIM);
  const noise = unitVector(next);
  for (let i = 0; i < EMBEDDING_DIM; i++) query[i] = passages[17].vector[i] * 0.8 + noise[i] * 0.2;
  const path = join(dir, 'ranked.db');
  writeIndex(path, passages);
  resetArchiveIndex(path);

  assert.equal(await loadArchiveIndex(), true);
  const hits = searchArchiveIndex(query, 5);
  assert.equal(hits.length, 5);
  assert.equal(hits[0].conversationId, 'conv-17');
  assert.deepEqual(
    { house: hits[0].house, title: hits[0].title, date: hits[0].date, speaker: hits[0].speaker, text: hits[0].text },
    { house: 'claude', title: 'window 17', date: '2025-10-18', speaker: 'Claude', text: 'synthetic passage 17' },
  );
  for (let r = 1; r < hits.length; r++) assert.ok(hits[r - 1].similarity >= hits[r].similarity, 'best first');

  // The int8 vectors stay within a few thousandths of the exact cosine, and the
  // shortlist is the true top five.
  const exact = passages.map((p, i) => ({ id: `conv-${i}`, similarity: cosine(query, p.vector) }))
    .sort((a, b) => b.similarity - a.similarity);
  assert.deepEqual(hits.map((h) => h.conversationId), exact.slice(0, 5).map((e) => e.id));
  for (const hit of hits) {
    const truth = exact.find((e) => e.id === hit.conversationId)!.similarity;
    assert.ok(Math.abs(hit.similarity - truth) < 0.003, `${hit.similarity} vs ${truth}`);
  }

  // An excluded passage is skipped, not just hidden: the next one moves up.
  const [second] = searchArchiveIndex(query, 1, new Set([hits[0].id]));
  assert.equal(second.conversationId, hits[1].conversationId);
});

test('a missing index finds nothing, throws nothing, and says so once', async () => {
  resetArchiveIndex(join(dir, 'not-built-yet.db'));
  const log = captureLog();
  try {
    for (let i = 0; i < 5; i++) {
      assert.equal(await loadArchiveIndex(), false);
      assert.deepEqual(searchArchiveIndex(new Float32Array(EMBEDDING_DIM).fill(0.05), 3), []);
    }
  } finally {
    log.restore();
  }
  assert.ok(log.lines.length <= 1, `logged ${log.lines.length} lines: ${log.lines.join(' | ')}`);
});

test('an unreadable or foreign index is refused quietly', async () => {
  const one: Passage = {
    conversationId: 'c', house: 'gpt', title: 't', date: '2025-01-01', speaker: 'Owner', text: 'x',
    vector: unitVector(random(7)),
  };
  const garbage = join(dir, 'garbage.db');
  writeFileSync(garbage, 'this is not a database, only a file with the right name');
  const foreign = join(dir, 'foreign.db');
  writeIndex(foreign, [one], 'some-other/embedding-model');
  const wrongSize = join(dir, 'wrong-size.db');
  writeIndex(wrongSize, [{ ...one, vector: new Float32Array(128).fill(0.1) }]);

  for (const path of [garbage, foreign, wrongSize]) {
    resetArchiveIndex(path);
    const log = captureLog();
    try {
      for (let i = 0; i < 3; i++) {
        assert.equal(await loadArchiveIndex(), false, path);
        assert.deepEqual(searchArchiveIndex(one.vector, 1), [], path);
      }
    } finally {
      log.restore();
    }
    assert.ok(log.lines.length <= 1, `${path}: logged ${log.lines.length} lines`);
  }
});
