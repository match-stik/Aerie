// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from './protocol.js';
import { withMissedReadMarks } from './read-marks.js';

const msg = (id: string, read_at: string | null, content = 'x') => ({ id, read_at, content } as unknown as Message);

test('a read stamp the phone missed is copied across, and nothing else changes', () => {
  const live = [msg('a', null, 'mine'), msg('b', '2026-10-17T07:00:00Z'), msg('c', null)];
  const snapshot = [msg('a', '2026-10-17T07:40:46Z', 'server copy'), msg('b', '2026-10-17T07:00:00Z'), msg('c', null)];
  const next = withMissedReadMarks(live, snapshot);
  assert.equal(next[0].read_at, '2026-10-17T07:40:46Z');
  assert.equal(next[0].content, 'mine');
  assert.equal(next[2].read_at, null);
});

test('when nothing was missed the same list comes back, so nothing re-renders', () => {
  const live = [msg('a', '2026-10-17T07:00:00Z')];
  assert.equal(withMissedReadMarks(live, [msg('a', '2026-10-17T07:00:00Z')]), live);
});
