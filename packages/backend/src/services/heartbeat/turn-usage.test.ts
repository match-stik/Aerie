// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// What one heartbeat turn spent: each reply once, and only the replies newer
// than the lane's watermark, so a resumed room's retyped history is never
// filed a second time.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUsageWatermark, usageSince, writeUsageWatermark } from './turn-usage.js';

const T = Date.parse('2030-01-15T12:00:00.000Z');
const at = (seconds: number) => new Date(T + seconds * 1000).toISOString();

// One reply, written the way Claude Code writes it: a record per content block,
// each a second apart, every one carrying the same usage.
function reply(id: string, seconds: number, cacheRead: number, blocks = 1, model = 'claude-opus-5-5'): string[] {
  const usage = { input_tokens: 2, output_tokens: 100, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 10 };
  return Array.from({ length: blocks }, (_, i) => JSON.stringify({
    type: 'assistant',
    requestId: `req_${id}`,
    timestamp: at(seconds + i),
    message: { id: `msg_${id}`, model, usage },
  }));
}

test("a resumed room's retyped history is not filed again", () => {
  // The resume copied two old replies into the new transcript with their own
  // ids and timestamps; the watermark sits on the newest one already filed.
  const raw = [...reply('old1', 0, 700_000), ...reply('old2', 10, 710_000), ...reply('new1', 20, 720_000)].join('\n');
  const turn = usageSince(raw, T + 10_000);
  assert.equal(turn.requests, 1);
  assert.equal(turn.cacheReadTokens, 720_000);
  assert.equal(turn.newest, T + 20_000);
});

test('a reply written as several records is counted once', () => {
  const raw = [...reply('a', 5, 500_000, 3), ...reply('b', 9, 510_000, 2)].join('\n');
  const turn = usageSince(raw, T);
  assert.equal(turn.requests, 2);
  assert.equal(turn.cacheReadTokens, 1_010_000);
  assert.equal(turn.outputTokens, 200);
  assert.equal(turn.inputTokens, 4);
  assert.equal(turn.cacheWriteTokens, 20);
});

test('a reply filed last turn stays filed when its later records land after the watermark', () => {
  // Its records are dated T+10 and T+11; the watermark is the T+10 it was filed at.
  const raw = reply('a', 10, 500_000, 2).join('\n');
  const turn = usageSince(raw, T + 10_000);
  assert.equal(turn.requests, 0);
  assert.equal(turn.newest, undefined);
});

test('the model is the newest counted reply’s', () => {
  const raw = [...reply('a', 5, 1, 1, 'claude-opus-5'), ...reply('b', 9, 1, 1, 'claude-opus-5-5')].join('\n');
  assert.equal(usageSince(raw, T).model, 'claude-opus-5-5');
});

test('an error notice and tool traffic are not replies', () => {
  const raw = [
    JSON.stringify({ type: 'assistant', timestamp: at(30), message: { id: 'msg_dead', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } }),
    JSON.stringify({ type: 'user', timestamp: at(31), message: { content: [{ type: 'tool_result', content: 'the word "usage" in a file' }] } }),
    'not json "usage"',
    ...reply('a', 32, 9),
  ].join('\n');
  const turn = usageSince(raw, T);
  assert.equal(turn.requests, 1);
  assert.equal(turn.cacheReadTokens, 9);
});

test('the watermark survives on disk, and an unreadable one reads as absent', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'aerie-watermark-')), '.usage-watermark');
  assert.equal(readUsageWatermark(path), undefined);
  writeUsageWatermark(path, T + 20_000);
  assert.equal(readUsageWatermark(path), T + 20_000);
  writeFileSync(path, 'not a number');
  assert.equal(readUsageWatermark(path), undefined);
  writeFileSync(path, '0');
  assert.equal(readUsageWatermark(path), undefined);
});
