// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../config.js';
import { archivistChoice } from './memory-extraction.js';

test('a fresh house ships with no Archivist model, so nobody starts on a key they do not have', () => {
  const config = loadConfig('/nonexistent/aerie-test-config.yaml');
  assert.equal(config.agent.archivist_provider, '');
  assert.equal(config.agent.archivist_model, '');
  assert.equal(archivistChoice(config.agent), null);
});

test('the Archivist runs only once both a provider and a model are chosen', () => {
  assert.equal(archivistChoice({ archivist_provider: 'anthropic', archivist_model: '' }), null);
  assert.equal(archivistChoice({ archivist_provider: '', archivist_model: 'claude-haiku-5-5' }), null);
  assert.equal(archivistChoice({ archivist_provider: '  ', archivist_model: '  ' }), null);
  assert.deepEqual(
    archivistChoice({ archivist_provider: ' anthropic ', archivist_model: 'claude-haiku-5-5' }),
    { provider: 'anthropic', model: 'claude-haiku-5-5' },
  );
});
