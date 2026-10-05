// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isRevealableSecret } from './secrets.js';

// GET /api/secrets/:name returns a raw value. It used to return ANY secret to
// any valid session, so a stolen cookie could read every key at once. Only the
// values the browser genuinely uses are revealable now; everything else is
// write-only from a client.

test('the browser-needed secrets are revealable', () => {
  for (const name of ['elevenlabs_api_key', 'giphy_api_key', 'cortex_mcp_url', 'cortex_auth_token']) {
    assert.ok(isRevealableSecret(name), `${name} should be revealable`);
  }
  // Per-companion voice ids, whatever the slug.
  assert.ok(isRevealableSecret('elevenlabs_voice_id:companion-a'));
  assert.ok(isRevealableSecret('elevenlabs_voice_id:some-new-slug'));
});

test('tokens and cloud keys are never revealable', () => {
  for (const name of [
    'discord_bot_token',
    'telegram_bot_token',
    'fcm_service_account',
    'github_token',
    'cloudflare_api_token',
    'cortex_auth_token_evil', // near-miss must not pass
    'elevenlabs_api_key_backup', // near-miss must not pass
  ]) {
    assert.equal(isRevealableSecret(name), false, `${name} must not be revealable`);
  }
});
