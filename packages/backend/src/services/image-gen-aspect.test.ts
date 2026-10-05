// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Aspect ratios.
//
// A ratio that isn't on the list doesn't fail — it becomes a square, which is
// the one shape every wake contract in this house explicitly rules out. That
// is how 3:4 produced a 1254x1254 selfie on Aug 25 with nothing to notice.
// These tests hold the list itself, and the phone's copy of it, in place.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const backendSource = readFileSync(new URL('./image-gen.ts', import.meta.url), 'utf8');

const ratioOf = (key: string) => {
  const row = new RegExp(`'${key}': \\{[^}]*apiSize: '(\\d+)x(\\d+)'`).exec(backendSource);
  assert.ok(row, `${key} is not in SIZE_MAP`);
  return Number(row[1]) / Number(row[2]);
};

test('3:4 and 4:3 exist and are actually those shapes', () => {
  assert.ok(Math.abs(ratioOf('3:4') - 3 / 4) < 0.01, '3:4 is not 3:4');
  assert.ok(Math.abs(ratioOf('4:3') - 4 / 3) < 0.01, '4:3 is not 4:3');
  // Not square is the whole point of the bug that produced them.
  assert.notEqual(ratioOf('3:4'), 1);
  assert.notEqual(ratioOf('4:3'), 1);
});

test('every named ratio has its mirror', () => {
  // The list is built in pairs; a lone ratio is a gap someone will fall into
  // exactly the way 3:4 was fallen into.
  for (const [a, b] of [['16:9', '9:16'], ['2:3', '3:2'], ['4:5', '5:4'], ['3:4', '4:3']]) {
    assert.ok(Math.abs(ratioOf(a) * ratioOf(b) - 1) < 0.02, `${a} and ${b} are not mirrors`);
  }
});

test('an unrecognised ratio says so instead of going quiet', () => {
  assert.match(backendSource, /unknown aspect ratio '\$\{key\}'/);
});

const phoneSource = readFileSync(
  new URL('../../../phone/src/components/studio/constants.ts', import.meta.url),
  'utf8',
);

// This used to check two literal keys — 3:4 and 4:3, the pair that caused the
// bug — which is a test that only ever catches the fault it was written for.
// Nine other ratios could go missing under it. Compare the whole set.
test('the phone offers exactly the ratios the backend can render', () => {
  const backendKeys = [...backendSource.matchAll(/^\s*'?([\w:]+)'?: \{ guidance:/gm)].map((m) => m[1]).sort();
  // 'custom' is a phone-side affordance — the user types their own dimensions — and
  // has no SIZE_MAP row by design.
  const phoneKeys = [...phoneSource.matchAll(/value: '([\w:]+)'/g)]
    .map((m) => m[1]).filter((k) => k !== 'custom').sort();
  assert.ok(backendKeys.length >= 12, `only found ${backendKeys.length} ratios in SIZE_MAP — the reader is broken, not the list`);
  assert.deepEqual(
    phoneKeys, backendKeys,
    'the picker and the renderer have drifted: a ratio is selectable and unrenderable, or renderable and unreachable',
  );
});

// The phone's own comment says this list MUST match the backend's. Nothing
// enforced it, and a Gemini model the backend does not recognise is silently
// ignored — the request quietly runs on the default instead, which is exactly
// what happened for months while the 3.5 family sat dead in both files.
test('the phone offers exactly the Antigravity models the backend accepts', () => {
  // The backend's array closes with `] as const;`, so a lazy match for `];`
  // runs past it and swallows the default-model constant underneath.
  const backendBlock = /export const ANTIGRAVITY_MODELS = \[([\s\S]*?)\](?: as const)?;/.exec(backendSource);
  const phoneBlock = /export const ANTIGRAVITY_MODELS = \[([\s\S]*?)\](?: as const)?;/.exec(phoneSource);
  assert.ok(backendBlock && phoneBlock, 'both lists must still be findable by name');
  const backendModels = [...backendBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  const phoneModels = [...phoneBlock[1].matchAll(/id: '([^']+)'/g)].map((m) => m[1]).sort();
  assert.ok(backendModels.length > 0 && phoneModels.length > 0, 'neither list may read as empty');
  assert.deepEqual(
    phoneModels, backendModels,
    'the Studio picker and the renderer disagree about which Gemini models exist',
  );
});
