// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isStaleChunkError, claimStaleReload } from './stale-build';

test('a renamed page chunk reads as a stale chunk', () => {
  assert.equal(isStaleChunkError('TypeError: Failed to fetch dynamically imported module: https://aerie.example.com/assets/PressEditor-BBJ1NC5v.js'), true);
  assert.equal(isStaleChunkError('Importing a module script failed.'), true);
  assert.equal(isStaleChunkError("TypeError: Cannot read properties of undefined (reading 'x')"), false);
  assert.equal(isStaleChunkError(undefined), false);
});

test('a reload is claimed once, then held for thirty seconds', () => {
  const m = new Map<string, string>();
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  assert.equal(claimStaleReload(store, 1_000_000), true);
  assert.equal(claimStaleReload(store, 1_010_000), false);
  assert.equal(claimStaleReload(store, 1_031_000), true);
});
