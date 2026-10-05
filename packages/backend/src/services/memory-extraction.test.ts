// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConversationBatch } from './memory-extraction.js';

function message(sequence: number, content: string) {
  return {
    sequence,
    role: sequence % 2 ? 'user' : 'companion',
    content,
    created_at: '2026-07-16T00:00:00.000Z',
  };
}

test('Archivist batches an oversized backlog from the oldest edge', () => {
  const pending = Array.from({ length: 20 }, (_, i) => message(i + 101, `message-${i + 101}-` + 'x'.repeat(400)));
  const batch = buildConversationBatch(pending, 'Ivy', 'America/Chicago', 2_400);

  assert.ok(batch);
  assert.equal(batch.messages[0].sequence, 101);
  assert.ok(batch.maxSequence < 120);
  assert.match(batch.text, /message-101/);
  assert.doesNotMatch(batch.text, /message-120/);
});

test('Archivist cursor target is the last message actually included', () => {
  const pending = [message(10, 'a'.repeat(1_600)), message(11, 'b'.repeat(1_600)), message(12, 'c')];
  const batch = buildConversationBatch(pending, 'Ivy', 'America/Chicago', 2_100);

  assert.ok(batch);
  assert.deepEqual(batch.messages.map((m) => m.sequence), [10]);
  assert.equal(batch.maxSequence, 10);
});
