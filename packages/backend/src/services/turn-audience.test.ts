// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discordTurnAudience, isTurnAudience, guestToolRefusal } from './turn-audience.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('the owner on Discord is the owner', () => {
  assert.deepEqual(discordTurnAudience(true, undefined), { kind: 'owner' });
  assert.deepEqual(discordTurnAudience(true, 'limited'), { kind: 'owner' });
});

test('anyone else is a guest at the trust their rule gives them', () => {
  assert.deepEqual(discordTurnAudience(false, 'full'), { kind: 'guest', trust: 'full' });
  assert.deepEqual(discordTurnAudience(false, 'standard'), { kind: 'guest', trust: 'standard' });
  assert.deepEqual(discordTurnAudience(false, 'limited'), { kind: 'guest', trust: 'limited' });
});

test('no rule, or a trust level nobody recognises, is the narrowest profile', () => {
  assert.deepEqual(discordTurnAudience(false, undefined), { kind: 'guest', trust: 'limited' });
  assert.deepEqual(discordTurnAudience(false, 'owner'), { kind: 'guest', trust: 'limited' });
});

test('only a well-formed audience passes the check', () => {
  assert.equal(isTurnAudience({ kind: 'owner' }), true);
  assert.equal(isTurnAudience({ kind: 'guest', trust: 'standard' }), true);
  assert.equal(isTurnAudience({ kind: 'guest', trust: 'root' }), false);
  assert.equal(isTurnAudience({ kind: 'guest' }), false);
  assert.equal(isTurnAudience('owner'), false);
  assert.equal(isTurnAudience(null), false);
});

test('the Discord handler stamps every turn it hands over with its audience', () => {
  const source = readFileSync(join(HERE, 'discord', 'index.ts'), 'utf-8');
  const call = source.slice(source.indexOf('this.agentService.processMessage('));
  const opts = call.slice(0, call.indexOf(');'));
  assert.match(opts, /audience: discordTurnAudience\(isOwner, getUserRule\(userId\)\?\.trustLevel\)/);
});

test('the lane is handed the audience in the inbox record', () => {
  const runtime = readFileSync(join(HERE, 'heartbeat', 'runtime.ts'), 'utf-8');
  const append = runtime.slice(runtime.indexOf('session.appendInbox({'));
  assert.match(append.slice(0, append.indexOf('});')), /audience/);
  const router = readFileSync(join(HERE, 'agent', 'agent-router-query.ts'), 'utf-8');
  // The audience is read from platformOpts once (turnAudience) and handed to the
  // CLI lane; the router/SDK tool path refuses tools for a guest via that same value.
  assert.match(router, /const turnAudience = isTurnAudience\(platformOpts\?\.audience\) \? platformOpts\.audience : undefined/);
  assert.match(router, /audience: turnAudience/);
  assert.match(router, /guestToolRefusal\(turnAudience, name\)/);
});

test('guestToolRefusal blocks every router tool for a guest', () => {
  const r = guestToolRefusal({ kind: 'guest', trust: 'full' }, 'shell_exec');
  assert.ok(r && r.ok === false);
  assert.match(r.result, /not available on a guest turn/);
  // Even a full-trust guest, even a read-shaped tool: the router path has no safe subset.
  assert.ok(guestToolRefusal({ kind: 'guest', trust: 'full' }, 'read_file'));
  assert.ok(guestToolRefusal({ kind: 'guest', trust: 'limited' }, 'core_memory_append'));
});

test('guestToolRefusal lets the owner and the wakes (no audience) run tools', () => {
  assert.equal(guestToolRefusal({ kind: 'owner' }, 'shell_exec'), null);
  assert.equal(guestToolRefusal(undefined, 'codex_exec'), null);
});
