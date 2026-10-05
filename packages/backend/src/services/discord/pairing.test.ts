// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb, getDb } from '../db/init.js';
import { loadConfig } from '../../config.js';
import { PairingService } from './pairing.js';

// SQLite hands rows back in the table's own snake_case. The pairing code read
// expires_at as expiresAt and user_id as userId, so an expired code was never
// refused (undefined < now is false) and an approval reported no user at all.
loadConfig();
initDb(join(mkdtempSync(join(tmpdir(), 'aerie-pairing-')), 'test.db'));
const pairing = new PairingService();

test('an expired code is refused, however it is asked for', () => {
  const code = pairing.createOrGet('user-old', 'old', 'chan-1');
  getDb().prepare('UPDATE discord_pairings SET expires_at = ? WHERE code = ?')
    .run(new Date(Date.now() - 60_000).toISOString(), code);
  const result = pairing.approve(code);
  assert.equal(result.success, false);
  assert.equal(pairing.listApproved().some((row) => row.userId === 'user-old'), false);
});

test('a live code approves the person who asked for it', () => {
  const code = pairing.createOrGet('user-new', 'new', 'chan-2');
  const result = pairing.approve(code.toLowerCase());
  assert.deepEqual(result, { success: true, userId: 'user-new' });
  assert.equal(pairing.listApproved().some((row) => row.userId === 'user-new'), true);
});

test('pending codes reach the phone in the shape it reads', () => {
  const code = pairing.createOrGet('user-pending', 'pending', 'chan-3');
  const row = pairing.listPending().find((entry) => entry.code === code);
  assert.ok(row, 'the pending code should be listed');
  assert.equal(row.userId, 'user-pending');
  assert.equal(row.channelId, 'chan-3');
  assert.equal(typeof row.expiresAt, 'string');
  assert.equal(typeof row.createdAt, 'string');
  assert.equal('user_id' in row, false, 'no raw snake_case columns');
});
