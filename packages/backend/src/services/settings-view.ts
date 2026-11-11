// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { isSecretConfigKey } from './secrets.js';
/**
 * What GET /api/settings may hand the phone.
 *
 * The config table also holds every stored secret under a `secret:` key (bot
 * tokens, provider keys, the push service account), and the settings route
 * used to return the whole table, so any logged-in page could read every one
 * of them in plain text (found by an outside audit). The phone never read
 * them from here: it asks /api/secrets, which reveals only an allowlist. So
 * they are simply left out.
 */

export function settingsForClient(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (isSecretConfigKey(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Keys the generic settings door (PUT /api/settings) must never write. */
export function isGuardedSettingKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  return k.startsWith('secret:') || k.startsWith('security.') || k.startsWith('auth.') || k === 'app_settings';
}

