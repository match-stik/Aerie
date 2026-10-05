// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TTS_MODEL, TTS_MODEL_CONFIG_KEY, resolveTtsModel } from './tts-model.js';

test('an unset or blank setting keeps the model the house has always used', () => {
  assert.equal(DEFAULT_TTS_MODEL, 'eleven_v3');
  assert.equal(TTS_MODEL_CONFIG_KEY, 'voice.tts_model');
  assert.equal(resolveTtsModel(undefined), 'eleven_v3');
  assert.equal(resolveTtsModel(null), 'eleven_v3');
  assert.equal(resolveTtsModel('   '), 'eleven_v3');
});

test('a named ElevenLabs model is used as written', () => {
  assert.equal(resolveTtsModel('eleven_v4'), 'eleven_v4');
  assert.equal(resolveTtsModel(' eleven_v4_turbo '), 'eleven_v4_turbo');
});

test('anything that is not an ElevenLabs model name falls back rather than being sent', () => {
  assert.equal(resolveTtsModel('v4'), 'eleven_v3');
  assert.equal(resolveTtsModel('eleven v4'), 'eleven_v3');
  assert.equal(resolveTtsModel('eleven_v4"; drop'), 'eleven_v3');
});
