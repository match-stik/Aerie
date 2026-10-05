// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { collectCodexMcpStatus, notificationBelongsToCodexThread } from './codex-daemon.js';

test('Codex activity follows the subscribed thread across provider turns', () => {
  const threadId = 'thread-live';

  assert.equal(notificationBelongsToCodexThread({
    threadId,
    turnId: 'turn-that-was-already-running',
  }, threadId), true);
  assert.equal(notificationBelongsToCodexThread({
    threadId,
    turnId: 'turn-returned-by-latest-start',
  }, threadId), true);
});

test('Codex activity from another thread cannot rearm this turn', () => {
  assert.equal(notificationBelongsToCodexThread({
    threadId: 'thread-other',
    turnId: 'turn-other',
  }, 'thread-live'), false);
  assert.equal(notificationBelongsToCodexThread({}, 'thread-live'), false);
  assert.equal(notificationBelongsToCodexThread({ threadId: 'thread-live' }, null), false);
});

test('a stale persisted thread scope falls back to the live daemon-wide MCP catalog', async () => {
  const calls: Record<string, unknown>[] = [];
  const rows = await collectCodexMcpStatus(async (params) => {
    calls.push(params);
    if (params.threadId) {
      return { error: { message: `thread not found: ${params.threadId}` } };
    }
    return {
      result: {
        data: [{
          name: 'codex_apps',
          serverInfo: { name: 'plugin-runtime', version: '1' },
          tools: {},
          authStatus: 'bearerToken',
        }],
        nextCursor: null,
      },
    };
  }, 'thread-from-before-restart');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'codex_apps');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].threadId, 'thread-from-before-restart');
  assert.equal('threadId' in calls[1], false, 'the retry must ask the daemon itself, not repeat the stale scope');
});

test('an MCP read error unrelated to thread attachment is not disguised by a fallback', async () => {
  let calls = 0;
  await assert.rejects(
    collectCodexMcpStatus(async () => {
      calls++;
      return { error: { message: 'transport unavailable' } };
    }, 'thread-live'),
    /transport unavailable/,
  );
  assert.equal(calls, 1);
});
