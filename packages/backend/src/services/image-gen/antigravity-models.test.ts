// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Studio's Antigravity painters come from the account (`agy models`, Nov 26 2026).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { loadConfig } = await import('../../config.js');
loadConfig(join(mkdtempSync(join(tmpdir(), 'agy-models-')), 'none.yaml'));
const { initDb } = await import('../db/init.js');
const { setConfig } = await import('../db/config.js');
const { parseAgyModels, knownAntigravityModels, refreshAntigravityModels, resetAntigravityModelRead } = await import('./antigravity-models.js');
const { ANTIGRAVITY_MODELS } = await import('./settings.js');
initDb(':memory:');

const listing = [
  'Fetching available models...',
  'gemini-4-hydrogen-high\tGemini 4 Hydrogen (High)',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
  '',
].join('\n');

test('only the Gemini painters are kept, by the names agy prints', () => {
  assert.deepEqual(parseAgyModels(listing), ['Gemini 4 Hydrogen (High)', 'Gemini 3.8 Flash (High)']);
});

test('a house that has never read the account offers the hand-typed list', () => {
  setConfig('image_gen.antigravity_models_cache', '');
  assert.deepEqual(knownAntigravityModels(), [...ANTIGRAVITY_MODELS]);
});

test('a read is kept, a failed read keeps the last good list, and a new model shows up', async () => {
  resetAntigravityModelRead();
  const got = await refreshAntigravityModels(async () => listing, 1_000);
  assert.ok(got.includes('Gemini 4 Hydrogen (High)'));
  resetAntigravityModelRead();
  const after = await refreshAntigravityModels(async () => { throw new Error('down'); }, 10_000_000);
  assert.deepEqual(after, got);
});
