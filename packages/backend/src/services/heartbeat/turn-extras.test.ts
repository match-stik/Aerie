// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
const { buildTurnExtras, joinTurnExtras } = await import('./turn-extras.js');

// Their person's rule, Oct 31 2026: the Codex and Claude lanes as identical as we can
// make them. Until then the Codex lane got none of these blocks: no status, no
// sticker shelf, no reactions, no whisper. Both lanes now build them through
// one door, and this file fails if either lane stops walking through it.

const HERE = import.meta.dirname;
const LANES = [
  ['the Claude heartbeat lane', join(HERE, 'runtime.ts')],
  ['the Codex lane', join(HERE, '..', 'agent', 'agent-router-query.ts')],
] as const;

for (const [name, file] of LANES) {
  test(`${name} builds its per-turn blocks through the shared door`, () => {
    const src = readFileSync(file, 'utf8');
    assert.match(src, /buildTurnExtras\(/, `${name} no longer calls buildTurnExtras`);
    assert.match(src, /joinTurnExtras\(/, `${name} no longer hands the blocks to its room`);
  });
}

test('a guest turn gets none of them, whatever lane it is in', async () => {
  const x = await buildTurnExtras({
    prompt: 'hi', laneKey: 'test', fresh: false, guest: true, archive: false,
    threadId: 't', reactionsSince: '2026-01-01T00:00:00Z',
  });
  assert.equal(joinTurnExtras(x), '');
});

test('the blocks go to the room in the order the Claude lane always used', () => {
  assert.equal(
    joinTurnExtras({ whisper: 'W', unfiled: 'U', stickers: 'S', reactions: 'R', ownerStatus: 'H' }),
    'WUSRH',
  );
});
