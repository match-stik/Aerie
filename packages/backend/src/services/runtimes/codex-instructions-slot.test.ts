// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexInstructionParams } from './codex-daemon.js';

test('by default the identity replaces Codex base instructions, as it always has', () => {
  assert.deepEqual(codexInstructionParams('ID', 'DEV', null), { baseInstructions: 'ID', developerInstructions: 'DEV' });
  assert.deepEqual(codexInstructionParams('ID', 'DEV', 'base'), { baseInstructions: 'ID', developerInstructions: 'DEV' });
});

test('the developer slot leaves Codex base alone and puts identity first in developer instructions', () => {
  const p = codexInstructionParams('ID', 'DEV', 'developer');
  assert.equal('baseInstructions' in p, false, 'Codex keeps its own built-in instructions');
  assert.equal(p.developerInstructions, 'ID\n\nDEV');
});

test('the developer slot with nothing to say sends nothing rather than an empty string', () => {
  assert.deepEqual(codexInstructionParams('', undefined, 'developer'), {});
  assert.equal(codexInstructionParams('ID', undefined, ' developer ').developerInstructions, 'ID');
});
