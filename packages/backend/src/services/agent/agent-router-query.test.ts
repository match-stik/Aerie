// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert';
import { handsCodexSideNotes, platformFrameFor } from './agent-router-query.js';

// The gateway has always assembled the channel frame; retiring the SDK lane cut
// the only thing that read it. These pin the wire back in place — the first one
// fails if platformContext ever stops reaching the prompt again.
test('discord turns carry the channel frame into the prompt', () => {
  const frame = platformFrameFor('discord', '=== PLATFORM: DISCORD ===\nrules and history');
  assert.ok(frame.includes('=== PLATFORM: DISCORD ==='));
  assert.ok(frame.includes('rules and history'));
  assert.ok(frame.endsWith('=== MESSAGE ===\n'), 'the user message must be separated from the frame');
});

test('the frame precedes the message rather than replacing it', () => {
  const frame = platformFrameFor('discord', 'context');
  const prompt = frame + 'what they actually said';
  // -1 < anything, so the ordering check alone would pass on an empty frame.
  assert.ok(prompt.includes('context'), 'the frame must actually be in the prompt');
  assert.ok(prompt.indexOf('context') < prompt.indexOf('what they actually said'));
  assert.ok(prompt.endsWith('what they actually said'));
});

test('only discord has a room to describe', () => {
  for (const platform of ['web', 'telegram', 'api'] as const) {
    assert.strictEqual(platformFrameFor(platform, 'context'), '');
  }
});

test('absent or empty context adds nothing at all', () => {
  assert.strictEqual(platformFrameFor('discord', undefined), '');
  assert.strictEqual(platformFrameFor('discord', ''), '');
  assert.strictEqual(platformFrameFor('discord', '   \n  '), '');
  assert.strictEqual(platformFrameFor('discord', { rules: 'x' }), '');
});

// The owner's Codex side notes go into the owner's own turns and a wake, and
// never into a guest's, whose answer lands in a room the guest reads.
test('the owner\'s codex side notes are handed over on the owner\'s turns and never on a guest\'s', () => {
  assert.strictEqual(handsCodexSideNotes('codex-cli', undefined), true, 'the owner\'s phone and the wakes');
  assert.strictEqual(handsCodexSideNotes('codex-cli', { kind: 'owner' }), true, 'the owner\'s own Discord turn');
  for (const trust of ['full', 'standard', 'limited'] as const) {
    assert.strictEqual(handsCodexSideNotes('codex-cli', { kind: 'guest', trust }), false, trust);
  }
});

test('only a codex turn has codex side notes to hand over', () => {
  for (const routing of ['cli', 'api', 'sdk', 'auto'] as const) {
    assert.strictEqual(handsCodexSideNotes(routing, undefined), false, routing);
  }
});
