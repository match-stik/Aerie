// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A guest's tag or reply in a server room comes home to their person; in a DM it stays
// in the DM's own thread.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { guestGoesHome } from './guest-thread.js';

test('a tag, a reply or a message about their person in a server room goes home', () => {
  assert.equal(guestGoesHome('guild', null, true), true);
  assert.equal(guestGoesHome('guild', 'ada', false), true);
  assert.equal(guestGoesHome('guild', null, false), false);
});

test('a reply to us in a DM stays in the DM thread', () => {
  assert.equal(guestGoesHome(null, null, true), false);
  assert.equal(guestGoesHome(null, 'ada', true), false);
});

test('the Discord router asks this before sending a guest home', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('guestGoesHome(batch.guildId, ownerMention, mentionsBot(firstMessage))'));
});
