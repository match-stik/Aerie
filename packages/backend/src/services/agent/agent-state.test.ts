// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { initDb } from '../db/init.js';
import { getConfig, setConfig } from '../db/config.js';
import {
  codexLaneKey,
  codexLaneKeysForThread,
  createAgentMutableState,
  hasCodexCompanionLanes,
  loadCodexSessionsIfNeeded,
  persistCodexSideNoteOffset,
} from './agent-state.js';

test('shared Codex lanes preserve the legacy Aerie thread-only session key', () => {
  assert.equal(codexLaneKey('thread-home', null), 'thread-home');
  assert.equal(codexLaneKey('thread-home'), 'thread-home');
});

test('Codex companion lanes are distinct within the same Aerie thread', () => {
  assert.equal(codexLaneKey('thread-home', 'birch-id'), 'thread-home:companion:birch-id');
  assert.equal(codexLaneKey('thread-home', 'willow-id'), 'thread-home:companion:willow-id');
  assert.notEqual(
    codexLaneKey('thread-home', 'birch-id'),
    codexLaneKey('thread-home', 'willow-id'),
  );
  assert.notEqual(
    codexLaneKey('thread-home', 'birch-id'),
    codexLaneKey('thread-other', 'birch-id'),
  );
});

test('a room with companion Codex sessions is detectable without choosing one transcript', () => {
  const sessions = new Map<string, string>([
    ['thread-home', 'shared-session'],
    [codexLaneKey('thread-home', 'birch-id'), 'birch-session'],
    [codexLaneKey('thread-other', 'willow-id'), 'other-session'],
  ]);
  assert.equal(hasCodexCompanionLanes(sessions, 'thread-home'), true);
  assert.equal(hasCodexCompanionLanes(sessions, 'thread-other'), true);
  assert.equal(hasCodexCompanionLanes(sessions, 'thread-empty'), false);
});

test('a withdrawn turn collects every Codex lane in that room, shared and per-companion', () => {
  const sessions = new Map<string, string>([
    ['thread-home', 'shared-thread'],
    ['thread-home:companion:birch-id', 'birch-thread'],
    ['thread-home:companion:willow-id', 'willow-thread'],
  ]);
  assert.deepEqual(codexLaneKeysForThread(sessions, 'thread-home').sort(), [
    'thread-home',
    'thread-home:companion:birch-id',
    'thread-home:companion:willow-id',
  ]);
});

test('a withdrawn turn never reaches another room', () => {
  const sessions = new Map<string, string>([
    ['thread-home', 'shared-thread'],
    ['thread-home-2', 'other-shared-thread'],
    ['thread-home-2:companion:cedar-id', 'other-cedar-thread'],
  ]);
  assert.deepEqual(codexLaneKeysForThread(sessions, 'thread-home'), ['thread-home']);
});

test('a room with no Codex lanes yields nothing to clear', () => {
  assert.deepEqual(codexLaneKeysForThread(new Map(), 'thread-home'), []);
});

test('a handed Codex side-note boundary survives a backend state rebuild', () => {
  initDb(':memory:');

  const lane = 'room:companion:cedar';
  persistCodexSideNoteOffset(lane, 380);
  setConfig('codex.side_note_offset.invalid', 'not-a-byte-offset');

  const state = createAgentMutableState();
  loadCodexSessionsIfNeeded(state);

  assert.equal(getConfig(`codex.side_note_offset.${lane}`), '380');
  assert.equal(state.codexSideNoteOffsets.get(lane), 380);
  assert.equal(state.codexSideNoteOffsets.has('invalid'), false);
});
