// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateAppIds, APPS, trimTrailingEmpty, drawerColumnsOf, seedLayoutFrom } from './apps';

test('memory fold: three legacy tiles collapse into ONE memory tile', () => {
  assert.deepEqual(
    migrateAppIds(['messages', 'cortex', 'memoryblocks', 'selfknowledge', 'journal']),
    ['messages', 'memory', 'journal'],
  );
});

test('legacy memory tile drops when a canonical memory tile already exists', () => {
  assert.deepEqual(migrateAppIds(['memory', 'cortex', 'journal']), ['memory', 'journal']);
});

test('every alias target and registry screen is a real registered app', () => {
  const ids = new Set(APPS.map((a) => a.id));
  for (const target of migrateAppIds(['gif', 'xray', 'cortex', 'memoryblocks', 'selfknowledge'])) {
    assert.ok(ids.has(target), `alias target ${target} missing from APPS`);
  }
});

test('the retired standalone tiles are gone from the registry', () => {
  const ids = new Set(APPS.map((a) => a.id));
  for (const retired of ['cortex', 'memoryblocks', 'selfknowledge', 'xray', 'gif']) {
    assert.ok(!ids.has(retired), `retired tile ${retired} still in APPS`);
  }
});

test('empty rows after the last app are trimmed, and gaps between apps stay', () => {
  // Each rearrange used to save two padded empty rows onto the end, so a
  // drawer moved about three times scrolled six rows into nothing.
  assert.deepEqual(trimTrailingEmpty(['a', null, 'b', null, null, null, null, null, null, null, null]), ['a', null, 'b']);
  assert.deepEqual(trimTrailingEmpty([null, 'a']), [null, 'a']);
  assert.deepEqual(trimTrailingEmpty([null, null]), []);
  assert.deepEqual(trimTrailingEmpty(['a', 'b']), ['a', 'b']);
});

test('the drawer is four in a row unless the owner picks five', () => {
  assert.equal(drawerColumnsOf(undefined), 4);
  assert.equal(drawerColumnsOf(5), 5);
  assert.equal(drawerColumnsOf('5'), 4);
  assert.equal(drawerColumnsOf(6), 4);
});

test('a row size opened for the first time starts from the other order, without its gaps', () => {
  assert.deepEqual(seedLayoutFrom(['a', null, 'b', 'c', null, 'd']), ['a', 'b', 'c', 'd']);
});
