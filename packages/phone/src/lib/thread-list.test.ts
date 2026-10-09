// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The thread list's two decisions: what a preview says, whichever door the
// list came through, and which group a room sits in.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupThreads, previewText } from './thread-list.js';
import type { ThreadSummary } from '../aerie';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('a preview reads as text whether it came from the socket or the REST list', () => {
  assert.equal(previewText('Willow: the lamps are lit'), 'Willow: the lamps are lit');
  assert.equal(
    previewText({ content: "**Birch**\nThe kettle's on.", role: 'companion', created_at: '2026-03-03T20:00:00.000Z' }),
    "**Birch** The kettle's on.",
  );
  assert.equal(previewText(null), null);
  assert.equal(previewText(''), null);
  assert.equal(previewText({ role: 'companion' }), null);
  assert.equal(previewText(42), null);
});

test('loading the list and drawing it both go through previewText', () => {
  const socket = read('../aerie/socket.ts');
  assert.match(socket, /threads: \(data\.threads \|\| \[\]\)\.map\(\(t: ThreadSummary\) => \(\{ \.\.\.t, last_message_preview: previewText\(t\.last_message_preview\) \}\)\)/);
  const switcher = read('../components/ThreadSwitcher.tsx');
  assert.match(switcher, /stripMarkdown\(previewText\(thread\.last_message_preview\) \?\? ''\)/);
});

const now = new Date(2026, 2, 3, 2, 30); // half two in the morning, local
function daily(id: string, at: Date): ThreadSummary {
  return { id, name: id, type: 'daily', unread_count: 0, last_activity_at: at.toISOString(), last_message_preview: null, pinned_at: null } as ThreadSummary;
}

test('an old daily folds into its month instead of standing under Today', () => {
  const january = daily('january', new Date(2026, 0, 14, 4, 39));
  const december = daily('december', new Date(2025, 11, 2, 18, 53));
  const groups = groupThreads([january, december], 'home', now);
  assert.deepEqual(groups.today, []);
  assert.deepEqual(groups.months.map(([key, list]) => [key, list.map((t) => t.id)]), [['2026-01', ['january']], ['2025-12', ['december']]]);
});

test("today's daily and the open daily stand under Today", () => {
  const todays = daily('today', new Date(2026, 2, 3, 0, 5));
  const open = daily('open', new Date(2025, 11, 1, 12, 0));
  const groups = groupThreads([todays, open], 'open', now);
  assert.deepEqual(groups.today.map((t) => t.id), ['today', 'open']);
  assert.deepEqual(groups.months, []);
});
