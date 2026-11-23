// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The starting walls say what each one is for, and what does not belong on
// it, and a house still carrying the first versions' notes gets the new ones.
import assert from 'node:assert/strict';
import test from 'node:test';
import { initDb } from './db/init.js';
import { createCompanion } from './db/companions.js';
import * as memoryBlocks from './memory-blocks.js';

initDb(':memory:');
memoryBlocks.initMemoryBlocks();
createCompanion({ slug: 'juniper', displayName: 'Juniper', claudeMdPath: '/unused', mcpJsonPath: '/unused' });
const companions = [{ slug: 'juniper', display_name: 'Juniper' }];

test('a new house starts with three walls, each saying what it is for', () => {
  memoryBlocks.seedDefaultBlocks('Alex', companions);
  const human = memoryBlocks.getBlock('shared', 'human')!;
  assert.equal(human.content, 'Name: Alex');
  assert.match(human.description ?? '', /^Who Alex is:/);
  const status = memoryBlocks.getBlock('shared', 'status')!;
  assert.match(status.description ?? '', /How to do a job goes in a skill, not here/);
  const persona = memoryBlocks.getBlock('juniper', 'persona')!;
  assert.equal(persona.content, 'I am Juniper.');
  assert.match(persona.description ?? '', /^Juniper's own wall/);
  const prompt = memoryBlocks.formatBlocksForPrompt(['shared', 'juniper']);
  assert.match(prompt, /belongs in a skill, and a finished story or old history belongs in Cortex/);
  assert.match(prompt, /<!-- What is true in the house right now/);
});

test('the first versions\' notes are replaced, and a note somebody wrote is kept', () => {
  memoryBlocks.setBlock('shared', 'status', '', 'Current status, ongoing projects, open questions');
  memoryBlocks.setBlock('juniper', 'persona', 'I am Juniper.', 'My own words about my wall');
  memoryBlocks.seedDefaultBlocks('Alex', companions);
  assert.match(memoryBlocks.getBlock('shared', 'status')!.description ?? '', /^What is true in the house right now/);
  assert.equal(memoryBlocks.getBlock('juniper', 'persona')!.description, 'My own words about my wall');
});

// A thread room's own dial: a wall the room sets to search is
// left out of that room's walls and only named, while the house's dial stays
// as it was for every other room.
test('a room\'s own dial is laid over the house\'s, wall by wall', () => {
  memoryBlocks.setBlock('shared', 'lore', 'THE LORE WALL TEXT', 'lore');
  const house = memoryBlocks.formatBlocksForPrompt(['shared', 'juniper']);
  assert.match(house, /THE LORE WALL TEXT/);
  const thread = memoryBlocks.formatBlocksForPrompt(['shared', 'juniper'], (scope, label) => (scope === 'shared' && label === 'lore' ? 'search' : undefined));
  assert.doesNotMatch(thread, /THE LORE WALL TEXT/);
  assert.match(thread, /THE LORE WALL TEXT|lore/);
  assert.match(memoryBlocks.formatBlocksForPrompt(['shared', 'juniper']), /THE LORE WALL TEXT/, 'the house dial is untouched');
});
