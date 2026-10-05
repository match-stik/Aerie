// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Every .sql in migrations/ is either applied by initDb or explicitly retired.
//
// initDb names its migration files one at a time — `001_init.sql`, then 006
// through 009 — so a file added to that directory does nothing at all unless
// somebody also edits init.ts. Nothing warns you. The database simply comes up
// without your table and the failure surfaces somewhere else entirely, later.
//
// Four files already sit in that gap (002–005). They are harmless because the
// schema they describe is created inline in init.ts instead, and that is
// recorded below with a reason rather than left for the next reader to work out.
//
// This test is the same instrument as routes-mounted.test.ts: it does not check
// that the schema is right, only that no migration file is silently ignored.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, '../../../migrations');
const INIT_SOURCE = join(here, 'init.ts');

/**
 * Migration files deliberately not read by initDb, and why. Anything listed
 * here is inert: its schema arrives by another route. Removing a file means
 * removing its entry too.
 */
const SUPERSEDED: Record<string, string> = {
  '002_add_sticker_content_type.sql':
    'rebuilds the messages table for content_type; init.ts performs that column work inline',
  '003_message_tts.sql':
    'message_tts is created inline in init.ts (CREATE TABLE IF NOT EXISTS message_tts)',
  '004_emojis.sql': 'the emojis table is created inline in init.ts',
  '005_emoji_packs.sql': 'emoji_packs and the emojis.pack_id column are created inline in init.ts',
};

test('every migration file is either applied by initDb or listed as superseded', () => {
  const initSource = readFileSync(INIT_SOURCE, 'utf-8');
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

  assert.ok(files.length > 0, 'no .sql files found — is MIGRATIONS_DIR still correct?');

  const ignored = files.filter(f => !initSource.includes(f) && !(f in SUPERSEDED));

  assert.deepEqual(
    ignored,
    [],
    `These migration files are never read and are not recorded as superseded:\n` +
      ignored.map(f => `  - ${f}`).join('\n') +
      `\n\nA file in migrations/ does nothing on its own. Either read it in initDb ` +
      `(services/db/init.ts), or add it to SUPERSEDED in this test with the reason ` +
      `its schema arrives another way.`,
  );
});

test('the superseded list has not rotted', () => {
  const files = new Set(readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')));
  const missing = Object.keys(SUPERSEDED).filter(f => !files.has(f));

  assert.deepEqual(
    missing,
    [],
    `SUPERSEDED names files that no longer exist: ${missing.join(', ')}. Remove the entries.`,
  );
});
