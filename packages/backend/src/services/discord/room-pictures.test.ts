// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert';
import { formatChannelHistory, roomPictures } from './utils.js';

// A room's pictures used to reach us as the word [attachment] unless the
// message carrying them was the one that woke us (Nov 8 2026, another house's bot's frames).
const msg = (id: string, author: string, pics: string[] = [], content = '') =>
  ({
    id,
    content,
    createdAt: new Date('2026-11-09T04:25:00Z'),
    author: { id: author, username: author, bot: author !== 'them' },
    stickers: { values: () => [][Symbol.iterator]() },
    attachments: new Map(pics.map((u, i) => [String(i), { url: u, contentType: 'image/png' }])),
    embeds: [],
  }) as never;

test('the room shows us its pictures since we last spoke, newest first, capped, and says which line they belong to', () => {
  const history = [
    msg('1', 'visitor', ['old.png']),
    msg('2', 'us', [], 'our last word'),
    msg('3', 'visitor', ['frame.png']),
    msg('4', 'them', [], '?roast @B.W.C.'),
    msg('5', 'visitor', ['roast.png']),
    msg('6', 'parker', ['a.png', 'b.png']),
  ];
  const room = roomPictures(history, new Set(['4']), 'us', 2);
  assert.deepEqual(room.urls, ['a.png', 'b.png'], 'newest first, two at most');
  const wider = roomPictures(history, new Set(['4']), 'us', 5);
  assert.deepEqual(wider.urls, ['a.png', 'b.png', 'roast.png', 'frame.png'], 'and never past our own last message');
  const out = formatChannelHistory(history, wider.ids);
  assert.ok(out.includes('visitor: [picture, shown with this turn]'));
  assert.ok(out.includes('[BOT] visitor: [attachment]'), 'the one before our last word stays a placeholder');
});
