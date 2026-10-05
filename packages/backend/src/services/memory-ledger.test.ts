// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { initDb } from './db/init.js';
import { listMemoryLedger, markMemoryLedgerSeen, memoryReceipt } from './memory-ledger.js';
import { runMemoryRounds } from './memory-rounds.js';
import { selectDejavuCandidate } from './heartbeat/whisper.js';

test('memory ledger records receipts and rounds are daily/idempotent', async () => {
  initDb(':memory:');
  memoryReceipt({ actor: 'test', action: 'memory.test', detail: 'A short receipt.' });
  const first = listMemoryLedger();
  assert.equal(first[0]?.detail, 'A short receipt.');
  markMemoryLedgerSeen(first[0]!.id);
  assert.ok(listMemoryLedger()[0]?.seen_at);

  const summary = await runMemoryRounds();
  assert.equal(summary.skipped, undefined);
  const second = await runMemoryRounds();
  assert.equal(second.skipped, true);
  assert.ok(listMemoryLedger().some(row => row.action === 'rounds.complete'));
});

test('deja vu chooses only the strongest source-veiled near miss', () => {
  assert.deepEqual(selectDejavuCandidate([
    { id: 'weak', similarity: 0.20 }, { id: 'near', similarity: 0.39 }, { id: 'nearer', similarity: 0.41 },
  ], 0.42), { id: 'nearer', similarity: 0.41 });
  assert.equal(selectDejavuCandidate([{ id: 'hit', similarity: 0.50 }], 0.42), null);
  assert.equal(selectDejavuCandidate([{ id: 'noise', similarity: 0.20 }], 0.42), null);
});
