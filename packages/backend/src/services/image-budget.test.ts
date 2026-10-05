// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetApplies, budgetRefusal } from './image-gen.js';

test('the cap only applies to the metered backend, and only when the owner set a figure', () => {
  assert.equal(budgetApplies('openai', 5), true);
  assert.equal(budgetApplies('openai', 0), false, 'no figure means no cap');
  assert.equal(budgetApplies('codex', 5), false, 'codex is free');
  assert.equal(budgetApplies('antigravity', 5), false);
  assert.equal(budgetApplies('openart', 5), false);
});

test('AN UNREADABLE METER REFUSES — absent is not false', () => {
  // This is the whole bug. The old query named a column that has never existed,
  // threw on every call, and a catch reported zero spent — so a budget of any
  // size was never once exceeded and the cap never fired.
  const refusal = budgetRefusal(null, 5);
  assert.ok(refusal, 'must refuse rather than wave it through');
  assert.match(refusal!, /cannot read what has been spent/);
  assert.doesNotMatch(refusal!, /\$0\.00/, 'must never present unknown as zero');
});

test('under the cap is allowed', () => {
  assert.equal(budgetRefusal(4.99, 5), null);
  assert.equal(budgetRefusal(0, 5), null, 'a real measured zero is fine');
});

test('at or over the cap refuses, and says both numbers', () => {
  const at = budgetRefusal(5, 5);
  assert.ok(at, 'reaching the budget is reaching it');
  assert.match(at!, /\$5\.00 \/ \$5\.00/);
  assert.match(budgetRefusal(7.5, 5)!, /\$7\.50 \/ \$5\.00/);
});

test('a measured zero and an unmeasurable one are different answers', () => {
  assert.equal(budgetRefusal(0, 5), null);
  assert.ok(budgetRefusal(null, 5));
});
