// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// A KIT SHOULD NOT BUILD FURNITURE FOR A ROOM IT DOES NOT SHIP.
//
// The house this came from keeps a familiar's egg. The service that reads it is
// held back, and yet the two tables it needs were still being created in every
// fresh install — empty, with nothing in this tree that ever opens them. At the
// owner's word, they are gone.
//
// Holding a FILE back is not holding a FEATURE back, and leftovers like these
// are how you tell which one actually happened.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb } from './init.js';

test('a fresh install builds no tables for rooms this kit does not have', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerie-kit-'));
  const db = initDb(join(dir, 'fresh.db'));
  try {
    const leftovers = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%egg%')",
    ).all() as Array<{ name: string }>).map((r) => r.name);
    assert.deepEqual(leftovers, [], 'tables for a feature that is not here');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
