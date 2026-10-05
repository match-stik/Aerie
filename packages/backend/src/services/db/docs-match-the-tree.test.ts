// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A STALE TRUTH HAS NO ERROR MESSAGE.
//
// Sep 10 2026: nine separate things in this repository were wrong in the same
// way, and not one of them was a lie when it was written. A comment swearing a
// phone constant was kept in step with its backend, a fortnight after it stopped
// being. A note at the top of docs/APPS.md naming four features the archive
// lacked, all four of which it had. The architecture map saying initDb reads
// migrations through 009_battleship.sql, months after 010_card_room.sql joined
// them. Every one accurate on the day, and nobody ever went back.
//
// Code throws when it is wrong. Prose does not — it sits there in confident
// handwriting being read by whoever comes next, and the only instrument that
// ever finds it is somebody going and looking at the thing instead of the record
// of the thing.
//
// So this looks, on every run. It does not check whether the docs are GOOD;
// that is not a thing a test can know. It checks the narrow class we actually
// got burned by: the doc naming a concrete, checkable fact about this tree, and
// the tree having moved.

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, '../..');            // packages/backend/src
const REPO = join(BACKEND, '../../..');         // repository root
const ARCHITECTURE = join(REPO, 'docs/ARCHITECTURE.md');

function architecture(): string {
  return readFileSync(ARCHITECTURE, 'utf-8');
}

test('every migration initDb reads is the one the map says it reads', () => {
  const init = readFileSync(join(BACKEND, 'services/db/init.ts'), 'utf-8');
  const read = [...init.matchAll(/migrations\/(\d{3}_[a-z0-9_]+\.sql)/g)].map((m) => m[1]);
  assert.ok(read.length > 0, 'found no migrations in init.ts — this test is reading the wrong file');

  const highest = read.sort().at(-1)!;
  const doc = architecture();

  // The map states the range as a "through <file>" phrase. If the highest
  // migration initDb actually executes is not the one named there, the sentence
  // has outlived the code — which is exactly how 009 survived 010 landing.
  assert.ok(
    doc.includes(highest),
    `docs/ARCHITECTURE.md never names ${highest}, which is the highest migration ` +
      `initDb executes. The map's migration range has gone stale.`,
  );
});

test('every mounted route file is named in the map', () => {
  const dir = join(BACKEND, 'routes');
  const routers = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .filter((f) => readFileSync(join(dir, f), 'utf-8').includes('export default'));

  const doc = architecture();
  const missing = routers.filter((f) => !doc.includes(f));

  assert.deepEqual(
    missing,
    [],
    `docs/ARCHITECTURE.md is the map, and these router files are not on it: ` +
      `${missing.join(', ')}. A route nobody documented is a route nobody finds.`,
  );
});
