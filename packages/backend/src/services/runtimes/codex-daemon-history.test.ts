// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCodexRecentHistory } from './codex-daemon.js';

test('Codex continuity reload keeps chronological history and does not echo the live user turn', () => {
  const context = formatCodexRecentHistory([
    { role: 'user', content: 'Earlier question' },
    { role: 'assistant', content: 'Earlier answer' },
    { role: 'user', content: 'Current question' },
  ], 'Current question', 'Owner');

  assert.match(context, /Owner: Earlier question/);
  assert.match(context, /Companion: Earlier answer/);
  assert.doesNotMatch(context, /Owner: Current question/);
  assert.ok(context.indexOf('Earlier question') < context.indexOf('Earlier answer'));
});

test('Codex continuity reload keeps the newest message when it is not the live prompt', () => {
  const context = formatCodexRecentHistory([
    { role: 'user', content: 'Previous question' },
    { role: 'assistant', content: 'Previous answer' },
  ], 'Autonomous wake prompt', 'Owner');

  assert.match(context, /Owner: Previous question/);
  assert.match(context, /Companion: Previous answer/);
});

test('Codex continuity reload is empty when history only contains the live prompt', () => {
  assert.equal(formatCodexRecentHistory([
    { role: 'user', content: 'Current question' },
  ], 'Current question', 'Owner'), '');
});
