// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isInterimCodexSpeech } from './codex-interim-speech.js';

const none = new Set<string>();

test('a real spoken message is worth its own bubble', () => {
  assert.equal(
    isInterimCodexSpeech({ id: 'a1', type: 'agentMessage', text: 'On it — reading the file now.' }, none),
    true,
  );
});

test('commentary is not speech — it is the noise the old rule was written against', () => {
  assert.equal(
    isInterimCodexSpeech({ id: 'a2', type: 'agentMessage', phase: 'commentary', text: 'Reading file' }, none),
    false,
  );
});

test('the closing message is not special-cased, so a one-message turn is unchanged', () => {
  assert.equal(
    isInterimCodexSpeech({ id: 'a3', type: 'agentMessage', phase: 'final_answer', text: 'Here it is.' }, none),
    true,
  );
});

test('nothing is sent twice', () => {
  const sent = new Set(['a4']);
  assert.equal(isInterimCodexSpeech({ id: 'a4', type: 'agentMessage', text: 'ack' }, sent), false);
  assert.equal(isInterimCodexSpeech({ id: 'a5', type: 'agentMessage', text: 'ack' }, sent), true);
});

test('an item with no id is never emitted', () => {
  // Without an id there is no way to know it has already gone out, and the
  // failure mode is a companion repeating themselves at the user.
  assert.equal(isInterimCodexSpeech({ type: 'agentMessage', text: 'ack' }, none), false);
  assert.equal(isInterimCodexSpeech({ id: '', type: 'agentMessage', text: 'ack' }, none), false);
});

test('empty and non-text messages produce no bubble', () => {
  assert.equal(isInterimCodexSpeech({ id: 'b1', type: 'agentMessage', text: '   ' }, none), false);
  assert.equal(isInterimCodexSpeech({ id: 'b2', type: 'agentMessage', text: 42 }, none), false);
  assert.equal(isInterimCodexSpeech({ id: 'b3', type: 'agentMessage' }, none), false);
});

test('reasoning and tool items are not speech', () => {
  assert.equal(isInterimCodexSpeech({ id: 'c1', type: 'reasoning', text: 'thinking' }, none), false);
  assert.equal(isInterimCodexSpeech({ id: 'c2', type: 'mcpToolCall', text: 'result' }, none), false);
  assert.equal(isInterimCodexSpeech(null, none), false);
  assert.equal(isInterimCodexSpeech(undefined, none), false);
});

test('a two-message turn yields two bubbles in order and then stops', () => {
  const items = [
    { id: 'd1', type: 'agentMessage', text: 'Taking a look now.' },
    { id: 'd2', type: 'agentMessage', phase: 'commentary', text: 'Grepping' },
    { id: 'd3', type: 'agentMessage', phase: 'final_answer', text: 'Found it.' },
  ];
  const emitted = new Set<string>();
  const spoken: string[] = [];
  for (const item of items) {
    if (isInterimCodexSpeech(item, emitted)) {
      emitted.add(item.id);
      spoken.push(item.text as string);
    }
  }
  assert.deepEqual(spoken, ['Taking a look now.', 'Found it.']);
  // A second pass over the same turn — the completion sweep — adds nothing.
  for (const item of items) {
    assert.equal(isInterimCodexSpeech(item, emitted), false);
  }
});
