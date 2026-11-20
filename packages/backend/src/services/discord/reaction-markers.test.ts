// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractReactionMarkers, reactArgument } from './reaction-markers.js';

test('reaction lines come out of the reply and nothing else is posted for them', () => {
  const r = extractReactionMarkers('[react:123456789012345678 🔥]\n[react:123456789012345679 <:sparkle:223456789012345678>]\n[SILENT]');
  assert.deepEqual(r.reactions, [
    { messageId: '123456789012345678', emoji: '🔥' },
    { messageId: '123456789012345679', emoji: '<:sparkle:223456789012345678>' },
  ]);
  assert.equal(r.text, '[SILENT]');
});

test('a reaction beside one new message leaves the message whole, and a repeat is sent once', () => {
  const r = extractReactionMarkers('**🔥 Birch**\nLeave the hammer marks in.\n\n[react:123456789012345678 🪵]\n[react:123456789012345678 🪵]');
  assert.equal(r.text, '**🔥 Birch**\nLeave the hammer marks in.');
  assert.equal(r.reactions.length, 1);
});

test('something that only looks like a marker is left alone', () => {
  const r = extractReactionMarkers('I would [react:soon 🔥] if I could.');
  assert.equal(r.reactions.length, 0);
  assert.equal(r.text, 'I would [react:soon 🔥] if I could.');
});

test('a custom emoji reacts by its id, a unicode one as itself', () => {
  assert.equal(reactArgument('<:sparkle:223456789012345678>'), '223456789012345678');
  assert.equal(reactArgument('<a:spin:123456789012345678>'), '123456789012345678');
  assert.equal(reactArgument('🔥'), '🔥');
});
