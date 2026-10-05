// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateAppIds, APPS } from './apps';

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
