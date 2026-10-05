// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from './db/init.js';
import { setConfig } from './db/config.js';
import { contextWindowFor } from './usage-pricing.js';
import {
  asModelInfo,
  CODEX_CLI_MODELS,
  CODEX_MODELS,
  EXTRA_MODEL_KEYS,
  extraModelsFor,
  parseExtraModels,
} from './model-catalog.js';

// This parser stands between a phone keyboard and the model the next turn
// runs on. Everything it drops, it drops silently — so what it accepts and
// what it refuses are both worth pinning down.

test('nothing typed is no extra models', () => {
  assert.deepEqual(parseExtraModels(''), []);
  assert.deepEqual(parseExtraModels(null), []);
  assert.deepEqual(parseExtraModels(undefined), []);
});

test('a bare id gets the id as its name', () => {
  assert.deepEqual(parseExtraModels('claude-opus-6'), [
    { id: 'claude-opus-6', name: 'claude-opus-6', contextLength: undefined },
  ]);
});

test('name and context window are optional, in that order', () => {
  assert.deepEqual(parseExtraModels('claude-opus-6 | Opus 6'), [
    { id: 'claude-opus-6', name: 'Opus 6', contextLength: undefined },
  ]);
  assert.deepEqual(parseExtraModels('claude-opus-6 | Opus 6 | 1000000'), [
    { id: 'claude-opus-6', name: 'Opus 6', contextLength: 1000000 },
  ]);
});

test('lines and commas both separate entries', () => {
  const byLine = parseExtraModels('gpt-5.7\ngpt-5.7-mini');
  const byComma = parseExtraModels('gpt-5.7, gpt-5.7-mini');
  assert.deepEqual(byLine.map(m => m.id), ['gpt-5.7', 'gpt-5.7-mini']);
  assert.deepEqual(byComma, byLine);
});

test('blank lines and # comments are skipped', () => {
  const parsed = parseExtraModels('\n# the one that ships in October\n\nclaude-opus-6\n');
  assert.deepEqual(parsed.map(m => m.id), ['claude-opus-6']);
});

test('an id with whitespace in it is refused', () => {
  // Two ids on one line, or a stray space. Either way it is a typo, and a
  // typo that reached the lane would take out the next turn rather than
  // this line.
  assert.deepEqual(parseExtraModels('claude opus 6'), []);
});

test('a repeated id is listed once, first spelling wins', () => {
  const parsed = parseExtraModels('claude-opus-6 | First\nclaude-opus-6 | Second');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'First');
});

test('a context window that is not a number is simply absent', () => {
  // Absent means the meter falls back to 200k, which is what it does today
  // for any id nobody has written down. A zero or a word must not become one.
  assert.equal(parseExtraModels('claude-opus-6 | Opus 6 | soon')[0].contextLength, undefined);
  assert.equal(parseExtraModels('claude-opus-6 | Opus 6 | 0')[0].contextLength, undefined);
});

test('an extra arrives at the picker flagged as the owner\'s own', () => {
  // `custom` is the contract with the phone: it is the only thing that tells
  // the sheet which rows it may offer to remove. A row the owner added with no way
  // to take it back off would make one typo permanent from their side.
  const dressed = asModelInfo(
    { id: 'gpt-5.7', name: 'GPT-5.7', contextLength: undefined },
    { provider: 'codex-cli', tier: 'included', nameSuffix: ' (Warm)' },
  );
  assert.equal(dressed.custom, true);
  assert.equal(dressed.name, 'GPT-5.7 (Warm)');
  assert.equal(dressed.provider, 'codex-cli');
});

test('with no database up, the extras are empty rather than an exception', () => {
  // The picker is not the only caller — the context meter reads this too, on
  // paths that run before anything is open. Failing quiet is the contract.
  assert.deepEqual(extraModelsFor('claude'), []);
  assert.deepEqual(extraModelsFor('codex'), []);
});

test('the warm Codex list carries exactly the ids of the stateless one', () => {
  // Both used to be written out by hand, seven entries each, differing only
  // by a suffix — the shape a value drifts in.
  assert.deepEqual(CODEX_CLI_MODELS.map(m => m.id), CODEX_MODELS.map(m => m.id));
  for (const model of CODEX_CLI_MODELS) {
    assert.equal(model.provider, 'codex-cli');
    assert.ok(model.name.endsWith(' (Warm)'), `${model.name} should say it is the warm lane`);
  }
});

// Everything below runs against a database, so it stays last in the file.

test('a model added to the config store is offered, and brings its window with it', () => {
  initDb(':memory:');
  setConfig(EXTRA_MODEL_KEYS.claude, 'claude-opus-6 | Opus 6 | 1000000\nclaude-opus-5');
  // claude-opus-5 is already written down in the catalog, so it does not get
  // listed twice for having been typed in as well.
  assert.deepEqual(extraModelsFor('claude').map(m => m.id), ['claude-opus-6']);
  // The whole reason the window is stated: without it this reads as 200k and
  // the meter in the thread header is wrong by a factor of five.
  assert.equal(contextWindowFor('claude-opus-6'), 1_000_000);
});

test('clearing the key takes the model back out again', () => {
  initDb(':memory:');
  setConfig(EXTRA_MODEL_KEYS.codex, 'gpt-5.7');
  assert.deepEqual(extraModelsFor('codex').map(m => m.id), ['gpt-5.7']);
  setConfig(EXTRA_MODEL_KEYS.codex, '');
  assert.deepEqual(extraModelsFor('codex'), []);
});
