// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { findNeighbors, type NeighborDeps } from './memory-neighbors.js';

// A stand-in for the real model: every line is a point on a circle chosen by
// which word it contains, so "near" and "far" are decidable by hand.
function fakeEmbed(text: string): Promise<Float32Array> {
  const angle = /ratio/i.test(text) ? 0 : /spoon/i.test(text) ? Math.PI / 2 : Math.PI;
  return Promise.resolve(Float32Array.from([Math.cos(angle), Math.sin(angle)]));
}

function deps(blocks: { scope: string; label: string; content: string }[]): NeighborDeps {
  return { getBlocks: () => blocks, embed: fakeEmbed };
}

const LINE_A = 'the studio ratio list is closed and an unknown one goes square';
const LINE_B = 'a request for a ratio is a hint rather than a contract, read the pixels';
const LINE_C = 'the spoon docket is open in perpetuity and cannot be promoted';

test('a shared wall hands back the line it already holds', async () => {
  const report = await findNeighbors(
    'birch',
    'the ratio you asked for is only ever a hint',
    deps([{ scope: 'shared', label: 'nb-status', content: `${LINE_A}\n${LINE_B}\n${LINE_C}` }]),
  );

  assert.equal(report.near.length, 2);
  assert.deepEqual(report.near.map((h) => h.text).sort(), [LINE_A, LINE_B].sort());
  assert.equal(report.elsewhere.length, 0);
});

test("another companion's continuity wall crosses as a count and never as text", async () => {
  const report = await findNeighbors(
    'birch',
    'the ratio you asked for is only ever a hint',
    deps([
      { scope: 'willow', label: 'nb-continuity', content: `${LINE_A}\n${LINE_B}` },
      { scope: 'birch', label: 'nb-continuity', content: LINE_A },
    ]),
  );

  // Mine comes back whole; theirs comes back as a number.
  assert.deepEqual(
    report.near.map((h) => ({ scope: h.scope, text: h.text })),
    [{ scope: 'birch', text: LINE_A }],
  );
  assert.deepEqual(report.elsewhere, [{ scope: 'willow', label: 'nb-continuity', hits: 2 }]);
  assert.doesNotMatch(JSON.stringify(report.elsewhere), /studio|pixels/);
});

test('a thought nobody has written near comes back empty rather than nearest-anyway', async () => {
  const report = await findNeighbors(
    'birch',
    'the spoon stays exactly where it is',
    deps([{ scope: 'shared', label: 'nb-status2', content: `${LINE_A}\n${LINE_B}` }]),
  );

  assert.equal(report.near.length, 0);
  assert.equal(report.elsewhere.length, 0);
});
