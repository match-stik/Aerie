// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { forgetGuestAvatars, guestAvatar, noteGuestAvatar } from './guest-avatars.js';

test('an old message shows the newest picture seen for its sender, whichever order they are read in', () => {
  forgetGuestAvatars();
  noteGuestAvatar('robin', 'https://cdn/new.webp', '2026-11-08T00:00:00Z');
  noteGuestAvatar('robin', 'https://cdn/old.webp', '2026-10-19T00:00:00Z');
  assert.equal(guestAvatar('robin', 'https://cdn/old.webp'), 'https://cdn/new.webp');
  noteGuestAvatar('robin', 'https://cdn/newer.webp', '2026-11-09T00:00:00Z');
  assert.equal(guestAvatar('robin', 'https://cdn/old.webp'), 'https://cdn/newer.webp');
});

test('somebody we have no picture for keeps the message own link, or none', () => {
  forgetGuestAvatars();
  assert.equal(guestAvatar('nobody', 'https://cdn/x.webp'), 'https://cdn/x.webp');
  assert.equal(guestAvatar(undefined, undefined), undefined);
  noteGuestAvatar('sam', undefined, '2026-11-09T00:00:00Z');
  assert.equal(guestAvatar('sam', undefined), undefined);
});
