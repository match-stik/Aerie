// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { threadTurnModel, modelLaneKey, modelLanesBeside, seedModelLaneTools } from './thread-model.js';

test('a thread with no model of its own rides the house model', () => {
  assert.equal(threadTurnModel(null, false, 'claude-opus-5'), 'claude-opus-5');
});

test('a thread model is used for their messages and not for wakes', () => {
  assert.equal(threadTurnModel('claude-fable-5-1', false, 'claude-opus-5'), 'claude-fable-5-1');
  assert.equal(threadTurnModel('claude-fable-5-1', true, 'claude-opus-5'), 'claude-opus-5');
});

test('the usual room is kept when the thread asks for the model it already runs', () => {
  assert.equal(modelLaneKey('primary', 'claude-opus-5', 'claude-opus-5'), null);
});

test('another model gets a room of its own, named for the model and the room beside it', () => {
  assert.equal(modelLaneKey('primary', 'claude-fable-5-1', 'claude-opus-5'), 'primary--claude-fable-5-1');
  // Two threads on the same model share one room.
  assert.equal(
    modelLaneKey('primary', 'claude-fable-5-1', 'claude-opus-5'),
    modelLaneKey('primary', 'claude-fable-5-1', 'claude-sonnet-5-5'),
  );
  // A companion's own head on another model is not the shared room on it.
  assert.notEqual(
    modelLaneKey('a732c63c', 'claude-fable-5-1', 'claude-opus-5'),
    modelLaneKey('primary', 'claude-fable-5-1', 'claude-opus-5'),
  );
  // Whatever a model id holds, the key is safe for a folder name.
  assert.match(modelLaneKey('primary', 'odd/model:1', 'x')!, /^[a-zA-Z0-9-_]+$/);
});

test('the model rooms beside a room are found on disk, and nobody else’s', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thread-model-'));
  try {
    for (const name of ['primary', 'primary--claude-fable-5-1', 'a732c63c', 'a732c63c--claude-haiku-5-5', 'primaryish']) {
      mkdirSync(join(dir, name));
    }
    assert.deepEqual(modelLanesBeside(dir, ['primary']).sort(), ['primary--claude-fable-5-1']);
    assert.deepEqual(modelLanesBeside(dir, ['primary', 'a732c63c']).sort(), ['a732c63c--claude-haiku-5-5', 'primary--claude-fable-5-1']);
    assert.deepEqual(modelLanesBeside(join(dir, 'missing'), ['primary']), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a new model room is handed the usual room’s tools once, owner-only, never overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thread-model-'));
  try {
    mkdirSync(join(dir, 'primary'));
    writeFileSync(join(dir, 'primary', '.mcp.json'), '{"mcpServers":{"a":{}}}');
    seedModelLaneTools(dir, 'primary--claude-fable-5-1', 'primary');
    const to = join(dir, 'primary--claude-fable-5-1', '.mcp.json');
    assert.equal(readFileSync(to, 'utf8'), '{"mcpServers":{"a":{}}}');
    assert.equal(statSync(to).mode & 0o777, 0o600);
    writeFileSync(to, '{"mine":true}');
    seedModelLaneTools(dir, 'primary--claude-fable-5-1', 'primary');
    assert.equal(readFileSync(to, 'utf8'), '{"mine":true}');
    // A room beside one that has no tools file gets none.
    seedModelLaneTools(dir, 'a732c63c--claude-fable-5-1', 'a732c63c');
    assert.equal(existsSync(join(dir, 'a732c63c--claude-fable-5-1', '.mcp.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
