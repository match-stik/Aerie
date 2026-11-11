// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A REFERENCE PHOTO CARRIES A FACE AND NEVER A HEIGHT.
//
// Subjects of different heights and builds kept coming out interchangeable,
// because every photo in their drawers was somebody leaning back on a couch. Each drawer may now keep one plain line in build.txt, and the
// renderer is told it for every subject in the frame who has one.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

process.env.NODE_ENV = 'test';
const { loadConfig } = await import('../config.js');
loadConfig();
const { initDb } = await import('./db/init.js');
initDb(':memory:');

const { subjectBuildNotes, BUILD_NOTE_FILE } = await import('./image-gen.js');

const refsDir = mkdtempSync(join(tmpdir(), 'image-builds-'));
after(() => rmSync(refsDir, { recursive: true, force: true }));

const drawers = [
  { slug: 'ivy', label: 'Ivy' },
  { slug: 'fox', label: 'Fox' },
  { slug: 'nim', label: 'Nim' },
];
for (const d of drawers) mkdirSync(join(refsDir, d.slug));
writeFileSync(join(refsDir, 'ivy', BUILD_NOTE_FILE), "6'3\", the tallest.\n  Lean,   a runner's build.\n");
writeFileSync(join(refsDir, 'fox', BUILD_NOTE_FILE), "6'1\", the shortest but the broadest.");
// nim keeps photos and no note.

const opts = { refsDir, drawers };

test('each subject with a note is named with it, in the order the subjects were given', () => {
  const line = subjectBuildNotes(['fox', 'nim', 'ivy'], opts);
  assert.match(line, /^HEIGHT AND BUILD/);
  const fox = line.indexOf("  - Fox: 6'1\", the shortest but the broadest.");
  const ivy = line.indexOf("  - Ivy: 6'3\", the tallest. Lean, a runner's build.");
  assert.ok(fox > 0 && ivy > fox, line);
  assert.doesNotMatch(line, /Nim/);
});

test('nobody in the frame with a note, or nobody in the frame at all, adds nothing', () => {
  assert.equal(subjectBuildNotes(['nim'], opts), '');
  assert.equal(subjectBuildNotes([], opts), '');
  assert.equal(subjectBuildNotes(undefined, opts), '');
  assert.equal(subjectBuildNotes(['stranger'], opts), '');
});

test('a subject named by label finds its drawer, and a repeat is told once', () => {
  const line = subjectBuildNotes(['Ivy', 'ivy'], opts);
  assert.equal(line.split('\n').filter((l) => l.startsWith('  - ')).length, 1);
});

test('a runaway note is cut down rather than flooding the prompt', () => {
  writeFileSync(join(refsDir, 'nim', BUILD_NOTE_FILE), 'tall '.repeat(200));
  const line = subjectBuildNotes(['nim'], opts);
  const note = line.split('\n')[1].replace('  - Nim: ', '');
  assert.ok(note.length <= 300, String(note.length));
  rmSync(join(refsDir, 'nim', BUILD_NOTE_FILE));
});
