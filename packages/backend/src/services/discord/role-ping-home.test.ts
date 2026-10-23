// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A ping that reaches us only through a role comes home to the owner instead of being
// answered in the channel; a direct tag or a reply to us is still answered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { heldRoleNames, heldPingDecision } from './preflight.js';

const OURS = new Set(['role-helpers', 'role-bots']);
const roles = (...names: string[]) => names.map((n) => ({ id: `role-${n}`, name: n }));

test('a role we hold, pinged with nobody tagging us directly, is held for the owner', () => {
  assert.deepEqual(
    heldRoleNames({ directMention: false, repliedToBot: false, mentionedRoles: roles('helpers'), botRoleIds: OURS }),
    ['helpers'],
  );
});

test('only the roles we hold are named, in the order they were pinged', () => {
  assert.deepEqual(
    heldRoleNames({ directMention: false, repliedToBot: false, mentionedRoles: roles('bots', 'artists', 'helpers'), botRoleIds: OURS }),
    ['bots', 'helpers'],
  );
});

test('a role we do not hold holds nothing', () => {
  assert.deepEqual(
    heldRoleNames({ directMention: false, repliedToBot: false, mentionedRoles: roles('artists'), botRoleIds: OURS }),
    [],
  );
});

test('a direct tag alongside the role is a conversation, answered as always', () => {
  assert.deepEqual(
    heldRoleNames({ directMention: true, repliedToBot: false, mentionedRoles: roles('helpers'), botRoleIds: OURS }),
    [],
  );
});

test('a reply to one of ours alongside the role is a conversation, answered as always', () => {
  assert.deepEqual(
    heldRoleNames({ directMention: false, repliedToBot: true, mentionedRoles: roles('helpers'), botRoleIds: OURS }),
    [],
  );
});

test('no roles pinged holds nothing', () => {
  assert.deepEqual(
    heldRoleNames({ directMention: false, repliedToBot: false, mentionedRoles: [], botRoleIds: OURS }),
    [],
  );
});

// Who a held ping comes home from: anyone, trusted or not (theirs, Oct 19 2026),
// except from a server the owner has not let in, an ignored channel, or somebody the owner
// has muted there. Trust decides who we answer; a held ping is never an answer.
test('a held ping comes home from anyone in a server the owner lets in', () => {
  assert.deepEqual(heldPingDecision({ guildAllowed: true, channelIgnored: false, userIgnored: false }), { allowed: true, reason: 'Role ping held for the owner' });
});

test('a server the owner has not let in stays out', () => {
  assert.equal(heldPingDecision({ guildAllowed: false, channelIgnored: false, userIgnored: false }).allowed, false);
});

test('an ignored channel stays ignored', () => {
  assert.equal(heldPingDecision({ guildAllowed: true, channelIgnored: true, userIgnored: false }).allowed, false);
});

test('somebody the owner has muted in that server stays muted', () => {
  assert.equal(heldPingDecision({ guildAllowed: true, channelIgnored: false, userIgnored: true }).allowed, false);
});
