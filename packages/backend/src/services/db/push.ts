// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Push subscription operations
// Migrated from ../db.ts
//
// Two shapes live in this table. `web_push` rows are the old PWA transport
// (endpoint + VAPID keys) and are kept so nothing breaks on read; `fcm` rows
// are what the APK registers — a device token and nothing else.

import { getDb } from './state.js';

export interface PushSubscription {
  id: string;
  type: 'web_push' | 'apns' | 'fcm';
  endpoint: string | null;
  keys_p256dh: string | null;
  keys_auth: string | null;
  device_token: string | null;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export function addPushSubscription(params: {
  id: string;
  endpoint: string;
  keysP256dh: string;
  keysAuth: string;
  deviceName?: string;
}): void {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO push_subscriptions (id, type, endpoint, keys_p256dh, keys_auth, device_name, created_at, last_used_at)
    VALUES (?, 'web_push', ?, ?, ?, ?, ?, NULL)
  `);
  stmt.run(params.id, params.endpoint, params.keysP256dh, params.keysAuth, params.deviceName || null, new Date().toISOString());
}

/** Register (or re-register) an APK device token. Keyed on the token itself so
 * a device that re-registers updates its row instead of accumulating rows. */
export function addFcmSubscription(params: {
  id: string;
  deviceToken: string;
  deviceName?: string;
}): void {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM push_subscriptions WHERE type = 'fcm' AND device_token = ?")
    .get(params.deviceToken) as { id: string } | undefined;

  if (existing) {
    db.prepare('UPDATE push_subscriptions SET device_name = ?, last_used_at = NULL WHERE id = ?')
      .run(params.deviceName || null, existing.id);
    return;
  }

  db.prepare(`
    INSERT INTO push_subscriptions (id, type, endpoint, keys_p256dh, keys_auth, device_token, device_name, created_at, last_used_at)
    VALUES (?, 'fcm', NULL, NULL, NULL, ?, ?, ?, NULL)
  `).run(params.id, params.deviceToken, params.deviceName || null, new Date().toISOString());
}

export function removePushSubscription(endpoint: string): boolean {
  const stmt = getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
  const result = stmt.run(endpoint);
  return result.changes > 0;
}

/** Drop a device token FCM has told us is dead (uninstalled / replaced). */
export function removePushSubscriptionByToken(deviceToken: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM push_subscriptions WHERE device_token = ?')
    .run(deviceToken);
  return result.changes > 0;
}

export function listPushSubscriptions(): PushSubscription[] {
  const stmt = getDb().prepare("SELECT * FROM push_subscriptions ORDER BY created_at DESC");
  return stmt.all() as unknown as PushSubscription[];
}

export function touchPushSubscription(endpoint: string): void {
  const stmt = getDb().prepare('UPDATE push_subscriptions SET last_used_at = ? WHERE endpoint = ?');
  stmt.run(new Date().toISOString(), endpoint);
}

/** Same as touchPushSubscription but keyed on the row id, since FCM rows have
 * no endpoint to key on. */
export function touchPushSubscriptionById(id: string): void {
  getDb()
    .prepare('UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}
