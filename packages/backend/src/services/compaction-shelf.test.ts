// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The shelf: every squash the lanes' transcripts hold, kept in the house's own
// database, because Claude Code deletes old transcripts and the summaries went
// with them. And the label on each one, which says whose head it came from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, getDb } from './db/init.js';
import { loadScanMarks } from './db/compactions.js';
import { createCompanion, type Companion } from './db/companions.js';
import { projectKeyForDir } from './agent/session-list.js';
import {
  compactionDetail, compactionPage, companionForLane, syncCompactionShelf, whoseHead,
} from './compaction-shelf.js';

const squash = (at: string, body: string) => JSON.stringify({
  type: 'user', isCompactSummary: true, timestamp: at,
  message: { role: 'user', content: body },
});

function companion(id: string, slug: string, name: string): Companion {
  return {
    id, slug, display_name: name, archetype: null, claude_md_path: '', mcp_json_path: '', model: null,
    model_autonomous: null, effort: null, avatar_url: null, color: null, emoji: null, phone: null, bio: null,
    status: null, is_primary: 0, sort_order: 0, created_at: '', updated_at: '',
  };
}

test('whose head: the shared room, a companion\'s own lane by their id, and a plain label for a lane nobody can name', () => {
  const cast = [
    companion('095dabe5-0000-4000-8000-000000000001', 'ash', 'Ash'),
    companion('0a9f59b3-0000-4000-8000-000000000002', 'birch', 'Birch'),
    companion('a732c63c-0000-4000-8000-000000000003', 'cedar', 'Cedar'),
  ];
  assert.equal(whoseHead('primary', null, cast), 'Shared room');
  assert.equal(whoseHead('0a9f59b3-0000-4000-8000-000000000002', 'birch', cast), "Birch's own head");
  assert.equal(companionForLane('a732c63c-0000-4000-8000-000000000003', cast)?.slug, 'cedar');
  assert.equal(companionForLane('primary', cast), null, 'the shared room belongs to nobody in particular');
  assert.equal(whoseHead('ffffffff-0000-4000-8000-00000000000f', null, cast), 'Lane ffffffff');

  // The supervisor names a lane folder after the id with anything outside
  // [A-Za-z0-9_-] turned into an underscore, so an odd id still finds its man.
  const odd = [companion('odd id/1', 'dot', 'Dot')];
  assert.equal(companionForLane('odd_id_1', odd)?.slug, 'dot');

  // A companion who has since left the house keeps the name they had when their
  // squash was first read, so their row does not turn into a stranger's.
  assert.equal(whoseHead('095dabe5-0000-4000-8000-000000000009', 'willow', cast), "Willow's own head");
  // And a renamed companion reads by the name they have now.
  const renamed = [companion('095dabe5-0000-4000-8000-000000000001', 'ash', 'Rowan')];
  assert.equal(whoseHead('095dabe5-0000-4000-8000-000000000001', 'ash', renamed), "Rowan's own head");
});

function house(dbPath = ':memory:') {
  initDb(dbPath);
  const example = createCompanion({
    slug: 'example', displayName: 'Example', claudeMdPath: '/not-read-by-this-test', mcpJsonPath: '/not-read-by-this-test',
  });
  const root = mkdtempSync(join(tmpdir(), 'aerie-compaction-shelf-'));
  const lanesRoot = join(root, 'data', 'heartbeat');
  const transcriptRoot = join(root, 'projects');
  for (const lane of ['primary', example.id]) mkdirSync(join(lanesRoot, lane, 'io'), { recursive: true });
  const write = (lane: string, file: string, lines: string[]) => {
    const dir = join(transcriptRoot, projectKeyForDir(join(lanesRoot, lane)));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), lines.join('\n') + '\n', 'utf8');
    return join(dir, file);
  };
  return {
    root, example, roots: { transcriptRoot, lanesRoot }, write,
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('every squash found is shelved once, with whose lane it was, and stays after its transcript is deleted', async () => {
  const h = house();
  try {
    const shared = h.write('primary', 'aaa.jsonl', [squash('2026-10-19T10:00:00.000Z', 'shared one')]);
    h.write('primary', 'bbb.jsonl', [squash('2026-10-19T10:00:00.000Z', 'shared one')]);
    const own = h.write(h.example.id, 'ccc.jsonl', [squash('2026-10-20T10:00:00.000Z', 'its own')]);

    assert.equal(await syncCompactionShelf(h.roots), 2, 'two squashes, the resumed copy folded into its original');
    assert.equal(await syncCompactionShelf(h.roots), 0, 'a second read finds nothing new');

    const stored = getDb().prepare('SELECT project, lane, companion, session_id, at, chars, summary, first_seen FROM compactions ORDER BY at').all() as any[];
    assert.deepEqual(stored.map((r) => [r.lane, r.companion, r.session_id, r.at, r.chars, r.summary]), [
      ['primary', null, 'aaa', '2026-10-19T10:00:00.000Z', 10, 'shared one'],
      [h.example.id, 'example', 'ccc', '2026-10-20T10:00:00.000Z', 7, 'its own'],
    ]);
    assert.equal(stored[0].project, projectKeyForDir(join(h.roots.lanesRoot, 'primary')));
    assert.ok(stored.every((r) => !Number.isNaN(Date.parse(r.first_seen))), 'when the house first read it');

    rmSync(shared);
    rmSync(join(shared, '..', 'bbb.jsonl'));
    rmSync(own);
    await syncCompactionShelf(h.roots);
    const page = compactionPage(50, 0);
    assert.deepEqual(page.compactions.map((r) => r.chars), [7, 10], 'both still listed, newest first');
    assert.deepEqual(page.compactions.map((r) => r.whose), ["Example's own head", 'Shared room']);
    assert.equal(compactionDetail(page.compactions[1].id)?.summary, 'shared one', 'readable in full with the transcript gone');
  } finally {
    h.done();
  }
});

test('the shelf pages newest first and says when there is more', async () => {
  const h = house();
  try {
    h.write('primary', 'aaa.jsonl', ['11', '12', '13'].map((d) => squash(`2026-10-${d}T00:00:00.000Z`, `day ${d}`)));
    await syncCompactionShelf(h.roots);
    const first = compactionPage(2, 0);
    const rest = compactionPage(2, 2);
    assert.deepEqual([first.total, first.hasMore, rest.total, rest.hasMore], [3, true, 3, false]);
    assert.deepEqual([...first.compactions, ...rest.compactions].map((r) => r.at.slice(0, 10)), ['2026-10-13', '2026-10-12', '2026-10-11']);
    assert.equal(compactionDetail('not-an-id'), null);
  } finally {
    h.done();
  }
});

const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), '../../migrations/015_compactions.sql');

test('where each transcript was read to is kept in the house database, not in the process', async () => {
  // So a restart does not mean opening every transcript again, and a different
  // database (a fresh house) is never told a transcript was read when it was not.
  const h = house();
  try {
    const path = h.write('primary', 'aaa.jsonl', [squash('2026-10-19T10:00:00.000Z', 'kept in the house')]);
    assert.equal(await syncCompactionShelf(h.roots), 1);
    const mark = loadScanMarks().get(path);
    assert.ok(mark, 'the mark is a row');
    assert.equal(mark.size, statSync(path).size);

    initDb(':memory:');
    assert.equal(await syncCompactionShelf(h.roots), 1, 'a database with no marks reads the transcript itself');
  } finally {
    h.done();
  }
});

test('after a restart an unchanged transcript is still skipped on sight, and a changed one is read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerie-compaction-reboot-'));
  const dbPath = join(dir, 'house.db');
  const h = house(dbPath);
  try {
    // A whole-second stamp, so putting it back is exact.
    const stamp = new Date('2026-10-19T10:00:00.000Z');
    const path = h.write('primary', 'aaa.jsonl', [squash('2026-10-19T10:00:00.000Z', 'AAAA')]);
    utimesSync(path, stamp, stamp);
    assert.equal(await syncCompactionShelf(h.roots), 1);
    getDb().close();
    initDb(dbPath);

    // Same size and same stamp, different bytes: only a reader that opened it could tell.
    writeFileSync(path, squash('2026-10-19T10:00:00.000Z', 'BBBB') + '\n', 'utf8');
    utimesSync(path, stamp, stamp);
    assert.equal(await syncCompactionShelf(h.roots), 0, 'skipped without being opened');

    utimesSync(path, stamp, new Date(stamp.getTime() + 5000));
    assert.equal(await syncCompactionShelf(h.roots), 1, 'a new stamp gets it read');
    assert.deepEqual(compactionPage(10, 0).compactions.map((r) => r.chars), [4, 4], 'both on the shelf');
  } finally {
    getDb().close();
    h.done();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a write that fails marks nothing as read, so the next read shelves it', async () => {
  const h = house();
  try {
    h.write('primary', 'aaa.jsonl', [squash('2026-10-19T10:00:00.000Z', 'not lost')]);
    getDb().exec('DROP TABLE compactions');
    await assert.rejects(syncCompactionShelf(h.roots));
    assert.equal(loadScanMarks().size, 0, 'the mark went with the failed write');

    getDb().exec(readFileSync(MIGRATION, 'utf8'));
    assert.equal(await syncCompactionShelf(h.roots), 1);
    assert.equal(compactionPage(10, 0).compactions[0].preview, 'not lost');
  } finally {
    h.done();
  }
});

test('an older phone opening a summary the old way still gets the whole text', async () => {
  // A phone built before Oct 21 2026 opens a summary by asking for the list
  // with full=1 when its row says truncated, until the owner refreshes it.
  const h = house();
  try {
    h.write('primary', 'aaa.jsonl', [squash('2026-10-19T10:00:00.000Z', 'the whole old way')]);
    await syncCompactionShelf(h.roots);
    const [row] = compactionPage(10, 0).compactions;
    assert.equal(row.truncated, true);
    assert.equal(row.summary, undefined, 'the list never carries the text unless asked');
    const [old] = compactionPage(10, 0, { withSummaries: true }).compactions;
    assert.equal(old.summary, 'the whole old way');
    assert.equal(old.truncated, false);
  } finally {
    h.done();
  }
});
