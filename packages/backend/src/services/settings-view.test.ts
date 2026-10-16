// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsForClient } from './settings-view.js';

test('the settings the phone gets carry no stored secret', () => {
  const view = settingsForClient({
    'agent.model': 'claude-opus-5-5',
    'secret:discord_bot_token': 'MTQ-not-a-real-token',
    'secret:fcm_service_account': '{"private_key":"x"}',
    'heartbeat.autocompact_tokens': '800000',
  });
  assert.deepEqual(view, { 'agent.model': 'claude-opus-5-5', 'heartbeat.autocompact_tokens': '800000' });
});
