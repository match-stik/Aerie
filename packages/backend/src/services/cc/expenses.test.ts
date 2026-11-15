// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// An expense logged by mistake can be taken back (Nov 15 2026: until then there
// was no way to, in the app or the API, so a wrong entry stayed in every total).
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
const { initDb } = await import('../db/init.js');
const { addExpense, deleteExpense, listExpenses} = await import('./expenses.js');
initDb(':memory:');

test('a deleted expense leaves the list and the totals, and a second delete says so', () => {
  const keep = addExpense({ amount: 10, description: 'keep', date: '2026-11-15' });
  const oops = addExpense({ amount: 99.5, description: 'oops', date: '2026-11-15' });
  assert.equal(listExpenses({}).total, 109.5);
  assert.equal(deleteExpense(oops.id), true);
  const ids = listExpenses({}).expenses.map((e: any) => e.id);
  assert.deepEqual(ids, [keep.id]);
  assert.equal(listExpenses({}).total, 10);
  assert.equal(deleteExpense(oops.id), false);
});
