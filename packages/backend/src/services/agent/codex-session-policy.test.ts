// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { codexSessionDisposition } from './codex-session-policy.js';

test('a timed-out new Codex thread is preserved for restart-safe resume', () => {
  assert.deepEqual(codexSessionDisposition({
    finishReason: 'timeout', runtimeError: 'Turn timed out', hasResponse: false,
    pendingSessionId: 'new-thread', existingSessionId: null,
  }), { action: 'preserve', sessionId: 'new-thread' });
});

test('a timed-out resumed Codex thread keeps its conversational history', () => {
  assert.deepEqual(codexSessionDisposition({
    finishReason: 'timeout', runtimeError: 'Turn timed out', hasResponse: false,
    pendingSessionId: null, existingSessionId: 'warm-thread',
  }), { action: 'preserve', sessionId: 'warm-thread' });
});

test('successful new and resumed threads commit while non-timeout failures clear', () => {
  assert.deepEqual(codexSessionDisposition({
    finishReason: 'complete', runtimeError: null, hasResponse: true,
    pendingSessionId: 'new-thread', existingSessionId: null,
  }), { action: 'commit', sessionId: 'new-thread' });
  assert.deepEqual(codexSessionDisposition({
    finishReason: 'complete', runtimeError: null, hasResponse: true,
    pendingSessionId: null, existingSessionId: 'warm-thread',
  }), { action: 'commit', sessionId: 'warm-thread' });
  assert.deepEqual(codexSessionDisposition({
    finishReason: 'complete', runtimeError: 'thread failed', hasResponse: false,
    pendingSessionId: null, existingSessionId: 'bad-thread',
  }), { action: 'clear', sessionId: 'bad-thread' });
});

test('a failed autonomous wake never clears an existing interactive session', () => {
  assert.deepEqual(codexSessionDisposition({
    finishReason: 'complete', runtimeError: 'wake model rejected', hasResponse: false,
    pendingSessionId: null, existingSessionId: 'interactive-thread', isAutonomous: true,
  }), { action: 'preserve', sessionId: 'interactive-thread' });
});
