// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert';
import { formatChannelHistory } from './utils.js';

// The channel history is how we read a room we were not addressed in. A sticker
// sent there is somebody speaking, and it used to render as '[embed]'.
const msg = (
  content: string,
  stickers: Array<{ name: string; id: string; format: number }> = [],
  attachments = 0,
) =>
  ({
    content,
    createdAt: new Date('2026-08-21T19:05:00Z'),
    author: { username: 'match.stik', bot: false },
    stickers: { values: () => stickers[Symbol.iterator]() },
    attachments: { size: attachments },
  }) as never;

test('a sticker in the channel history says its name, not [embed]', () => {
  const out = formatChannelHistory([msg('', [{ name: 'zzzzzzzz', id: '42', format: 1 }])]);
  assert.ok(out.includes('zzzzzzzz'), 'the sticker name has to survive into what we read');
  assert.ok(!out.includes('[embed]'), 'and it must not fall through to the placeholder');
});

test('text plus a sticker keeps both', () => {
  const out = formatChannelHistory([msg('look', [{ name: 'peacekiss', id: '7', format: 1 }])]);
  assert.ok(out.includes('look'));
  assert.ok(out.includes('peacekiss'));
});

test('a lottie sticker has no image form, so the placeholder still stands', () => {
  const out = formatChannelHistory([msg('', [{ name: 'wiggle', id: '9', format: 3 }])]);
  assert.ok(out.includes('[embed]'), 'nothing renderable means nothing to name');
});

test('the ordinary cases are untouched', () => {
  assert.ok(formatChannelHistory([msg('just words')]).includes('just words'));
  assert.ok(formatChannelHistory([msg('', [], 1)]).includes('[attachment]'));
  assert.ok(formatChannelHistory([msg('')]).includes('[embed]'));
});
