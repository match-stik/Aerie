// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { keepIfSame } from './rail-lines.js';

const line = (id: string, content: string) => ({ id, role: 'companion', content, createdAt: '2026-11-23T10:00:00Z', companionSlug: 'rowan' });

test('a reload that says the same things keeps the list the table already has', () => {
  const prev = [line('a', 'B-10'), line('b', 'daubed')];
  const next = [line('a', 'B-10'), line('b', 'daubed')];
  assert.equal(keepIfSame(prev, next), prev);
});

test('a new line, an edited line or a different order takes the new list', () => {
  const prev = [line('a', 'B-10')];
  assert.notEqual(keepIfSame(prev, [line('a', 'B-10'), line('b', 'new')]), prev);
  assert.notEqual(keepIfSame(prev, [line('a', 'B-11')]), prev);
  const swapped = [line('b', 'y'), line('a', 'x')];
  assert.equal(keepIfSame([line('a', 'x'), line('b', 'y')], swapped), swapped);
});
