// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitCommand } from './toy-command-admit.js';
import { isRedWord } from './safeword.js';

const now = Date.parse('2026-10-12T23:00:00.000Z');
const longAgo = '2026-10-12T22:50:00.000Z';

test('a stop is let through however late it arrives', () => {
  assert.equal(admitCommand({ action: 'stop', at: longAgo }, now, 60_000), 'stop');
});

test('only a play can be too old to act on', () => {
  assert.equal(admitCommand({ action: 'play', at: longAgo }, now, 60_000), 'stale');
  assert.equal(admitCommand({ action: 'play', at: new Date(now - 1000).toISOString() }, now, 60_000), 'play');
});

test('red counts with the curly quotes and ellipsis a phone keyboard adds', () => {
  for (const said of ['red', 'RED!', '*red*', '“Red”', '‘red’', 'Red…', 'red red']) {
    assert.equal(isRedWord(said), true, said);
  }
  for (const said of ['red wine', 'I said red earlier', 'bred']) assert.equal(isRedWord(said), false, said);
});
