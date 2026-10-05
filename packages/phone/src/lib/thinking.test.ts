// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { MessageSegment } from '../aerie/protocol.js';
import { coalesceThinkingSegments, plainThinkingText, thinkingTitle } from './thinking.js';

function thinking(content: string, summary = ''): MessageSegment {
  return { type: 'thinking', content, summary };
}

function text(content: string): MessageSegment {
  return { type: 'text', content };
}

const thinkingCards = (segments: MessageSegment[]) =>
  coalesceThinkingSegments(segments).filter((s) => s.type === 'thinking');

test('a thought with words in it survives coalescing', () => {
  const out = thinkingCards([thinking('They asked twice, so it matters.'), text('Here.')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type === 'thinking' && out[0].content, 'They asked twice, so it matters.');
});

test('an empty authored thought renders no card at all', () => {
  // The failure this guards: the card still rendered, titled "Thinking…",
  // and tapping it opened an empty box.
  assert.equal(thinkingCards([thinking(''), text('Here.')]).length, 0);
  assert.equal(thinkingCards([thinking('   \n\n  '), text('Here.')]).length, 0);
});

test('a card that is only the routing marker renders no card', () => {
  assert.equal(thinkingCards([thinking('[AERIE_THOUGHT]\n'), text('Here.')]).length, 0);
});

test('dropping an empty thought leaves the spoken text alone', () => {
  const out = coalesceThinkingSegments([thinking(''), text('Here.')]);
  assert.deepEqual(out, [text('Here.')]);
});

test('a summary-only thought is a real thought and is kept', () => {
  const out = thinkingCards([thinking('', 'Checking the renderer'), text('Here.')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type === 'thinking' && out[0].content, 'Checking the renderer');
});

test('the session-recycle seam is never swallowed as an empty thought', () => {
  const out = thinkingCards([thinking('[Session recycled — re-primed]'), thinking('')]);
  assert.equal(out.length, 1);
  assert.match(out[0].type === 'thinking' ? out[0].content : '', /^\[Session recycled/);
});

test('thinkingTitle still has its placeholder for callers that hold real text', () => {
  assert.equal(thinkingTitle('  '), 'Thinking…');
  assert.equal(plainThinkingText('[AERIE_THOUGHT]\nMine.'), 'Mine.');
});
