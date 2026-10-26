// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The owner reactions since the lane's last turn ride along with their next one, theirs
// only, named by whose message and how it opens (Oct 26 2026).

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOwnerReactions, voicesOf, openingOf, readableEmoji, type ReactedRow } from './owner-reactions.js';

const row = (content: string, reactions: unknown[], role = 'assistant'): ReactedRow => ({ role, content, metadata: JSON.stringify({ reactions }) });

test('only the owner reactions after the mark, oldest first, named by whose message', () => {
  const rows = [
    row('**🌫️ Willow**\nFixed, and proven both ways on a real screen.', [
      { emoji: '🫦', user: 'user', created_at: '2026-10-26T07:40:00.000Z' },
      { emoji: '🔥', user: 'discord:123', created_at: '2026-10-26T07:41:00.000Z' },
    ]),
    row('**🔥 Birch**\n*grins*\nKept.\n::birch_claphands::\n\n**✨ Cedar**\nGood.', [
      { emoji: '🧡', user: 'user', created_at: '2026-10-26T07:35:00.000Z' },
      { emoji: '😂', user: 'user', created_at: '2026-10-26T07:00:00.000Z' },
    ]),
  ];
  const block = formatOwnerReactions(rows, '2026-10-26T07:30:00.000Z', '2026-10-26T07:45:00.000Z');
  const lines = block.split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(lines, [
    '- 🧡 on the message from Birch and Cedar, the one that opens "grins"',
    '- 🫦 on Willow\'s message, the one that opens "Fixed, and proven both ways on a real screen."',
  ]);
});

test('nothing new is nothing at all', () => {
  assert.equal(formatOwnerReactions([row('**🔥 Birch**\nHi', [])], '2026-10-26T00:00:00Z', '2026-10-27T00:00:00Z'), '');
  assert.equal(formatOwnerReactions([{ role: 'assistant', content: 'x', metadata: 'not json' }], '', 'z'), '');
});

test('the pieces read the way a person would', () => {
  assert.deepEqual(voicesOf('**🔥 Birch**\nA\n\n**🌫️ Willow**\nB\n**🔥 Birch**\nC'), ['Birch', 'Willow']);
  assert.equal(readableEmoji('<a:wave:223456789012345678>'), ':wave:');
  assert.equal(readableEmoji('🪿'), '🪿');
  assert.equal(openingOf('**✨ Cedar**\n::cedar_good::\n-# a whisper here'), 'a whisper here');
  assert.ok(openingOf('**✨ Cedar**\n' + 'word '.repeat(40)).endsWith('…'));
});
