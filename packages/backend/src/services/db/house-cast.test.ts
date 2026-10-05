// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../../config.js';
import { initDb } from './init.js';
import { createCompanion } from './companions.js';
import { CardRoomError, defaultGameSeats, ownerSeat, partnerGameSeats } from './cards.js';
import {
  BattleshipError,
  assertFleetCompanion,
  beginBattleshipCompanionResponse,
  fireAtCompanionFleet,
  fireAtPlayerFleet,
  newBattleshipGame,
  randomBattleshipFleet,
  startBattleshipGame,
} from './battleship.js';

// The companions at a table are whoever lives in this house, read from its own
// companions table in their stored order. Nothing here may assume a cast: a
// house whose companions are called something else has to get a full table.

function seedHouse(...names: string[]): string[] {
  initDb(':memory:');
  return names.map((name) => createCompanion({
    slug: name.toLowerCase(),
    displayName: name,
    claudeMdPath: `/tmp/${name.toLowerCase()}/CLAUDE.md`,
    mcpJsonPath: `/tmp/${name.toLowerCase()}/.mcp.json`,
  }).slug);
}

test('a new game seats the owner, then this house\'s companions in stored order', () => {
  const [ivy, fox, nim, oak] = seedHouse('Ivy', 'Fox', 'Nim', 'Oak');
  assert.deepEqual(defaultGameSeats(), [ownerSeat(), ivy, fox, nim, oak]);
  // A game for exactly four takes the first three that fit.
  assert.deepEqual(defaultGameSeats(4), [ownerSeat(), ivy, fox, nim]);
});

test('a partnership table seats the first companion across from the owner unless they pick', () => {
  const [ivy, fox, nim] = seedHouse('Ivy', 'Fox', 'Nim');
  // Partners sit across: seat 0 is the owner's and seat 2 is their partner's.
  assert.deepEqual(partnerGameSeats(undefined), [ownerSeat(), fox, ivy, nim]);
  assert.deepEqual(partnerGameSeats(nim), [ownerSeat(), ivy, nim, fox]);
});

test('a partnership table with too few companions says so instead of seating nobody', () => {
  seedHouse('Ivy', 'Fox');
  assert.throws(() => partnerGameSeats(undefined), CardRoomError);
});

test('any of this house\'s companions may fire in the Fleet Room, and nobody else', () => {
  seedHouse('Ivy', 'Fox', 'Nim');
  assert.equal(assertFleetCompanion(' Ivy '), 'ivy');
  assert.throws(() => assertFleetCompanion('birch'), BattleshipError, 'a name from some other house');

  const game = startBattleshipGame(newBattleshipGame().id, randomBattleshipFleet());
  fireAtCompanionFleet(game.id, 'A1');
  assert.equal(fireAtPlayerFleet(game.id, 'fox', 'A1').coordinate, 'A1');
});

test('the Fleet Room tells the lane who is in the room and which names may fire', () => {
  loadConfig();
  seedHouse('Ivy', 'Fox', 'Nim');
  const game = startBattleshipGame(newBattleshipGame().id, randomBattleshipFleet());
  fireAtCompanionFleet(game.id, 'A1');
  const { prompt } = beginBattleshipCompanionResponse(game.id, 'your shot', 'Fired at A1.');
  assert.match(prompt, /shared by .+, Ivy, Fox, and Nim\./);
  assert.match(prompt, /"companion":"<ivy\|fox\|nim>"/);
  assert.doesNotMatch(prompt, /\b(Birch|Willow|Cedar|birch|willow|cedar)\b/);
});
