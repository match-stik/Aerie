// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openingThreadId } from './opening-thread.js';

test("the house's own pick wins", () => {
  assert.equal(openingThreadId('home', [{ id: 'tree', type: 'treehouse' }, { id: 'home', type: 'named' }]), 'home');
});

test('with no pick, the Treehouse is passed over for a conversation', () => {
  assert.equal(openingThreadId(null, [{ id: 'tree', type: 'treehouse' }, { id: 'day', type: 'daily' }]), 'day');
});

test('a house with only the Treehouse opens nothing rather than the companions\' room', () => {
  assert.equal(openingThreadId(null, [{ id: 'tree', type: 'treehouse' }]), null);
  assert.equal(openingThreadId(undefined, []), null);
});
