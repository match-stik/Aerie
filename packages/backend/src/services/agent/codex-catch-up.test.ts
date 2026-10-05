// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { selectCodexCatchUpHistory } from './codex-catch-up.js';

const row = (sequence: number, role: 'user' | 'companion' | 'system', content: string) => ({
  sequence,
  role,
  content,
});

test('a resumed Codex lane receives only messages newer than its bookmark', () => {
  const history = selectCodexCatchUpHistory([
    row(10, 'companion', 'Already seen'),
    row(11, 'user', 'Missed question'),
    row(12, 'companion', 'Missed answer'),
    row(13, 'user', 'Live question'),
  ], 10, 13, 30, 13);

  assert.deepEqual(history, [
    { role: 'user', content: 'Missed question' },
    { role: 'assistant', content: 'Missed answer' },
  ]);
});

test('the hand-through boundary excludes messages queued after this turn', () => {
  const history = selectCodexCatchUpHistory([
    row(20, 'user', 'Current turn'),
    row(21, 'user', 'Queued behind it'),
  ], 19, 20, 30, 20);

  assert.deepEqual(history, []);
});

test('an existing lane without a bookmark gets one bounded migration catch-up', () => {
  const messages = Array.from({ length: 40 }, (_, index) => (
    row(index + 1, index % 2 === 0 ? 'user' : 'companion', `Message ${index + 1}`)
  ));
  const history = selectCodexCatchUpHistory(messages, undefined, 40, 30);

  assert.equal(history.length, 30);
  assert.equal(history[0].content, 'Message 11');
  assert.equal(history.at(-1)?.content, 'Message 40');
});

test('system furniture does not enter a resumed Codex transcript', () => {
  const history = selectCodexCatchUpHistory([
    row(30, 'system', 'Synthetic timeout'),
    row(31, 'user', 'Actual message'),
  ], 29, 31);

  assert.deepEqual(history, [{ role: 'user', content: 'Actual message' }]);
});
