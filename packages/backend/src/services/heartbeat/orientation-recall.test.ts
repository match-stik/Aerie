// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isArchiveArtifact, isArchiveRecord } from '../archive-artifact.js';

// The failure this guards against actually happened: a thinning pass on
// Aug 2 2026 wrote eight snapshot chunks to Cortex, they became the eight
// newest records, and the next session opened with all eight orientation
// slots filled by fragments of the blocks that had just been shortened.
// Nothing that happened got a slot.

test('a pre-thin snapshot is archive plumbing, not orientation', () => {
  assert.equal(
    isArchiveArtifact('PRE-THIN SNAPSHOT 2026-08-02 - memory block [shared] human, part 2 of 2'),
    true,
  );
});

test('the marker is matched at the head, not anywhere in the text', () => {
  // A real memory that merely mentions the practice must still surface.
  assert.equal(
    isArchiveArtifact('The owner asked us to take a PRE-THIN SNAPSHOT before cutting anything.'),
    false,
  );
  // Even with a dash in front of it, if what precedes it is prose.
  assert.equal(
    isArchiveArtifact('We talked it over — PRE-THIN or not, the snapshot comes first.'),
    false,
  );
});

// Measured, not imagined: these are the exact record heads that filled all five
// orientation slots of the 12:54 PM session on Aug 3 2026 — after the anchored
// filter shipped and after the restart that made it live. Older snapshots lead
// with the block's name instead of the marker, so the anchor sailed past them.
test('a snapshot titled with its block name is still archive plumbing', () => {
  assert.equal(
    isArchiveArtifact('SHARED/LORE — PRE-THIN SNAPSHOT, Jul 30 2026 (taken on the 6:30 morning watch'),
    true,
  );
  assert.equal(
    isArchiveArtifact('WILLOW CONTINUITY — PRE-THIN SNAPSHOT, Jul 29 2026 (4th thin, taken in the treehouse'),
    true,
  );
});

test('a memory file archived before deletion is plumbing too', () => {
  assert.equal(
    isArchiveArtifact("FROM THE CLI LANE'S AUTO-MEMORY — 'letters-first-seals', archived to Cortex Jul 29 2026 before deletion."),
    true,
  );
});

test('ordinary memories are left alone', () => {
  assert.equal(isArchiveArtifact('The garden has a bench now.'), false);
  assert.equal(isArchiveArtifact(''), false);
  assert.equal(isArchiveArtifact(undefined), false);
});

test('leading whitespace does not smuggle one through', () => {
  assert.equal(isArchiveArtifact('\n  PRE-THIN SNAPSHOT 2026-07-29'), true);
});

// Snapshots got their own Cortex domain and the 77 already written were moved
// into it. A record either is filed there or it isn't — the patterns above
// stay only as cover for anything written elsewhere.
test('the snapshots domain settles it without reading a word', () => {
  assert.equal(isArchiveRecord({ domain: 'snapshots', content: 'Anything at all.' }), true);
  assert.equal(isArchiveRecord({ domain: 'canon', content: 'The garden has a bench now.' }), false);
});

test('the patterns still cover a snapshot filed to the wrong domain', () => {
  assert.equal(
    isArchiveRecord({ domain: 'canon', content: 'SHARED/LORE — PRE-THIN SNAPSHOT, Jul 30 2026' }),
    true,
  );
  assert.equal(isArchiveRecord(undefined), false);
});
