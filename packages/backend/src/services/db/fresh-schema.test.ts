// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// A FRESH CLONE IS THE ONE MACHINE THIS HOUSE DOES NOT OWN.
//
// The fault this exists for has happened at least twice, and both times it was
// invisible here: an `ALTER TABLE x ADD COLUMN y` sitting ABOVE the statement
// that creates x. On a box where the table is older than the migration it works
// perfectly — the ALTER finds the table and adds the column. On a brand new
// database the ALTER throws "no such table", an empty catch eats it, and the
// CREATE then builds the table WITHOUT the column. Nothing is logged. Every
// test here passes. The column is simply missing on every machine but ours.
//
// usage_events.companion_id was exactly that, found by carrying the code to the
// kit rather than by any test. So this is the instrument that would have caught
// it without leaving the house: build a genuinely empty database, run the real
// initialisation over it, and then ask the database whether every column the
// migrations claim to add is actually there.
//
// It reads the statements out of init.ts and the migration files rather than
// listing them by hand, so a new ALTER is covered the day it is written.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './init.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '../../../migrations');

interface AddColumn {
  table: string;
  column: string;
  source: string;
}

/** Every ADD COLUMN the initialisation performs, wherever it is written. */
function addColumnStatements(): AddColumn[] {
  const sources: Array<[string, string]> = [['init.ts', readFileSync(join(here, 'init.ts'), 'utf8')]];
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    sources.push([file, readFileSync(join(migrationsDir, file), 'utf8')]);
  }

  const found: AddColumn[] = [];
  for (const [source, sql] of sources) {
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+ADD\s+COLUMN\s+([A-Za-z0-9_]+)/gi)) {
      found.push({ table: m[1], column: m[2], source });
    }
  }
  return found;
}

/** A database with nothing in it, initialized exactly the way a real box does it. */
function freshlyInitialised() {
  const dir = mkdtempSync(join(tmpdir(), 'aerie-fresh-'));
  const db = initDb(join(dir, 'fresh.db'));
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('a brand new database gets EVERY column the migrations add', () => {
  const statements = addColumnStatements();
  assert.ok(statements.length > 10, 'expected to find the ADD COLUMN statements at all');

  const { db, cleanup } = freshlyInitialised();
  try {
    const missing: string[] = [];
    for (const { table, column, source } of statements) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (cols.length === 0) {
        missing.push(`${table} does not exist at all (${source} tries to add ${column})`);
        continue;
      }
      if (!cols.some((c) => c.name === column)) {
        missing.push(`${table}.${column} is missing — ${source} adds it, and the ALTER was swallowed`);
      }
    }
    assert.deepEqual(missing, [], `a fresh clone would be missing columns:\n  ${missing.join('\n  ')}`);
  } finally {
    cleanup();
  }
});

test('the tables a migration alters are created BEFORE it alters them', () => {
  // The ordering fault stated directly, so a failure names the CAUSE rather
  // than only the symptom. A table created in a .sql file that runs earlier is
  // fine; this only compares statements written in the same file.
  //
  // THIS IS DELIBERATELY TWO PASSES AND THE FIRST VERSION WAS ONE. Collecting
  // the creates while walking down the file means that at the moment you reach
  // a too-early ALTER its table has not been recorded yet — so it reads as
  // "created in a .sql file" and gets waved through. The check could not fail
  // on the exact fault it was written for, and only breaking init.ts on purpose
  // showed it: the two tests that ask the DATABASE went red and this one stayed
  // green. Collect every CREATE first, then judge the ALTERs.
  const src = readFileSync(join(here, 'init.ts'), 'utf8').split('\n');
  const created = new Map<string, number>();
  src.forEach((line, i) => {
    const c = /CREATE TABLE(?: IF NOT EXISTS)?\s+([A-Za-z0-9_]+)/i.exec(line);
    if (c && !created.has(c[1])) created.set(c[1], i + 1);
  });

  const problems: string[] = [];
  src.forEach((line, i) => {
    const a = /ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+ADD\s+COLUMN/i.exec(line);
    if (!a) return;
    const madeAt = created.get(a[1]);
    // Absent here means it comes from a .sql migration, which runs first.
    if (madeAt !== undefined && madeAt > i + 1) {
      problems.push(`${a[1]}: altered on line ${i + 1}, created on line ${madeAt}`);
    }
  });

  assert.deepEqual(problems, [], `an ALTER runs before its own CREATE TABLE:\n  ${problems.join('\n  ')}`);
});
test('the story shelf tables land whole on a fresh install, and a second boot keeps what is in them', () => {
  // 014 creates its three tables whole, so the ADD COLUMN sweep above never
  // looks at them. Named column by column for that reason.
  const dir = mkdtempSync(join(tmpdir(), 'aerie-fresh-story-'));
  const path = join(dir, 'fresh.db');
  let db = initDb(path);
  try {
    const columns = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    assert.deepEqual(columns('story_books'), [
      'id', 'title', 'genre', 'spicy', 'blurb', 'bible', 'cover_url', 'created_by', 'status', 'created_at',
      'updated_at', 'finished_at', 'opened_at', 'companion_pending', 'companion_error',
    ]);
    assert.deepEqual(columns('story_pages'), [
      'id', 'book_id', 'at', 'kind', 'author', 'text', 'image_url', 'state_json', 'choices_json', 'widget', 'choice_id',
    ]);
    assert.deepEqual(columns('story_keepsakes'), [
      'id', 'item', 'note', 'from_book_id', 'to_book_id', 'maker', 'created_at', 'woven_at',
    ]);
    const keys = (table: string) =>
      (db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ from: string; table: string; to: string; on_delete: string }>)
        .map((k) => [k.from, k.table, k.to, k.on_delete])
        .sort();
    assert.deepEqual(keys('story_pages'), [['book_id', 'story_books', 'id', 'CASCADE']]);
    assert.deepEqual(keys('story_keepsakes'), [
      ['from_book_id', 'story_books', 'id', 'CASCADE'],
      ['to_book_id', 'story_books', 'id', 'SET NULL'],
    ]);
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_story_%' ORDER BY name").all() as Array<{ name: string }>)
      .map((i) => i.name);
    assert.deepEqual(indexes, ['idx_story_books_status', 'idx_story_keepsakes_from', 'idx_story_keepsakes_to', 'idx_story_pages_book']);

    db.prepare(`INSERT INTO story_books (id, title, genre, bible, created_by, created_at, updated_at)
                VALUES ('b1', 'A book', 'gothic', 'The bible.', 'example', 'now', 'now')`).run();
    db.close();
    db = initDb(path);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM story_books').get() as { n: number }).n, 1, 'a reboot re-runs 014 harmlessly');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// The house this came from keeps a third test here, on a table that is held
// back from this tree — so it is deliberately not carried. A test that asserts
// a feature the kit does not ship is red on every machine but the one that
// wrote it, which is the exact class of fault the two tests above exist for.
