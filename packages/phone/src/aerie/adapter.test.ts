// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Message as AerieMessage } from './protocol.js';
import { toPhoneMessage } from './adapter.js';

function row(over: Partial<AerieMessage>): AerieMessage {
  return {
    id: 'm1',
    thread_id: 't1',
    sequence: 1,
    role: 'system',
    content: 'hello',
    content_type: 'text',
    platform: 'discord',
    metadata: null,
    companion_id: null,
    reply_to_id: null,
    reply_to_preview: null,
    edited_at: null,
    deleted_at: null,
    original_content: null,
    created_at: '2026-08-15T09:00:00.000Z',
    delivered_at: null,
    read_at: null,
    ...over,
  } as AerieMessage;
}

// The hop that quietly does not happen. The gateway can capture a guest's
// picture perfectly and the phone still draws a letter, because nothing in
// between carried it. This pins the carry, not the capture.
test('a Discord guest arrives with their picture', () => {
  const m = toPhoneMessage(row({
    metadata: {
      discordUsername: 'guest_one',
      discordDisplayName: 'Guest One',
      discordAvatarUrl: 'https://cdn.discordapp.com/avatars/1/2.png?size=128',
    },
  }));
  assert.equal(m.sender, 'Guest One');
  assert.equal(m.via, 'Discord');
  assert.equal(m.senderAvatar, 'https://cdn.discordapp.com/avatars/1/2.png?size=128');
});

// Every message stored before we started capturing it. The rail falls back to
// an initial, so absent has to stay absent rather than becoming a broken image.
test('a guest from before we captured pictures carries none', () => {
  const m = toPhoneMessage(row({
    metadata: { discordUsername: 'guest_one', discordDisplayName: 'Guest One' },
  }));
  assert.equal(m.sender, 'Guest One');
  assert.equal(m.senderAvatar, undefined);
});

// The house's own system lines are not guests and have no face to draw.
test('a house system line is not given an avatar', () => {
  const m = toPhoneMessage(row({ platform: 'web', content: 'Recycling.' }));
  assert.equal(m.isSystem, true);
  assert.equal(m.via, undefined);
  assert.equal(m.senderAvatar, undefined);
});

// Messages the owner sends from Discord are the owner's, not a visitor's — they must not
// pick up a guest rail on the way through.
test('an owner message bridged in is not a guest', () => {
  const m = toPhoneMessage(row({
    role: 'user',
    metadata: { discordUsername: 'owner', discordAvatarUrl: 'https://cdn/x.png' },
  }));
  assert.equal(m.sender, undefined);
  assert.equal(m.direction, 'inbound');
});

// FILMS RIDE LIKE PICTURES (Sep 24 2026). A film is stored as a plain 'file',
// so without its mime being read it would draw as a download chip.
test('a film becomes a player, a picture stays a picture, a zip stays a file', () => {
  const m = toPhoneMessage(row({
    role: 'companion',
    platform: 'web',
    content: 'Done.',
    metadata: {
      attachments: [
        { url: '/api/files/v', filename: 'willow-in-paper.mp4', mimeType: 'video/mp4', contentType: 'file' },
        { url: '/api/files/p', filename: 'a.png', mimeType: 'image/png', contentType: 'image' },
        { url: '/api/files/z', filename: 'willow-in-paper.zip', mimeType: 'application/zip', contentType: 'file' },
      ],
    },
  }));
  assert.match(m.content, /\[VIDEO\]:\/api\/files\/v/);
  assert.match(m.content, /\[IMG\]:\/api\/files\/p/);
  assert.match(m.content, /\[FILE:willow-in-paper\.zip\]:\/api\/files\/z/);
});
