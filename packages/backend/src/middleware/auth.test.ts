// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldRenewSession } from './auth.js';

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const NOW = Date.parse('2026-08-19T12:00:00.000Z');

const expiringIn = (ms: number) => new Date(NOW + ms).toISOString();

test('a session issued moments ago is not rewritten', () => {
  // Nothing of the window has been spent yet, so ordinary traffic on a fresh
  // login must cost neither a database write nor a Set-Cookie header.
  assert.equal(shouldRenewSession(expiringIn(WEEK), NOW), false);
  assert.equal(shouldRenewSession(expiringIn(WEEK - 60_000), NOW), false);
});

test('renewal holds off until a full day of the window is spent', () => {
  // One second short of a day in: still no write.
  assert.equal(shouldRenewSession(expiringIn(WEEK - DAY + 1000), NOW), false);
  // A day in: renew.
  assert.equal(shouldRenewSession(expiringIn(WEEK - DAY), NOW), true);
});

test('an old but still-valid session renews', () => {
  // This is the case that logged a user out mid-upload: six days in, technically
  // alive, and every fresh HTTP call about to start 401ing at day seven.
  assert.equal(shouldRenewSession(expiringIn(DAY), NOW), true);
  assert.equal(shouldRenewSession(expiringIn(60_000), NOW), true);
});

test('an unreadable expiry never triggers a write', () => {
  // Absent is not false: if we cannot read the expiry we leave the row alone
  // rather than silently handing out a fresh week on a value we did not parse.
  assert.equal(shouldRenewSession('not a date', NOW), false);
  assert.equal(shouldRenewSession('', NOW), false);
});

test('clock skew into the future does not renew', () => {
  // An expiry further out than a whole window means someone else already
  // extended it, or the clock moved. Either way there is nothing to buy.
  assert.equal(shouldRenewSession(expiringIn(WEEK + DAY), NOW), false);
});

test('login turns away a password that is not a short string before touching it', async () => {
  const { loginHandler } = await import('./auth.js');
  const { loadConfig } = await import('../config.js');
  const { mkdtempSync, writeFileSync } = await import('fs');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const dir = mkdtempSync(join(tmpdir(), 'login-test-'));
  writeFileSync(join(dir, 'aerie.yaml'), 'auth:\n  password: correct-horse\n');
  loadConfig(join(dir, 'aerie.yaml'));
  const statusFor = (body: unknown): number => {
    let code = 0;
    const res = { status(c: number) { code = c; return this; }, json() { return this; }, cookie() { return this; } };
    loginHandler({ body, headers: {}, ip: '127.0.0.1' } as never, res as never);
    return code;
  };
  // An object with a length used to reach Buffer.from and be compared (401);
  // with a big enough length it built a gigabyte array on the event loop.
  assert.equal(statusFor({ password: { length: 5 } }), 400);
  assert.equal(statusFor({ password: ['a'] }), 400);
  assert.equal(statusFor({ password: 'x'.repeat(1025) }), 400);
  assert.equal(statusFor({}), 400);
  assert.equal(statusFor(undefined), 400);
});

test('a password change needs the current password and a real new one', async () => {
  const { checkPasswordChange } = await import('./auth.js');
  assert.deepEqual(checkPasswordChange('old-pass', 'new-pass', 'old-pass', false), { ok: true });
  assert.equal(checkPasswordChange(undefined, 'new-pass', 'old-pass', false).ok, false);
  assert.equal(checkPasswordChange('wrong', 'new-pass', 'old-pass', false).ok, false);
  assert.equal(checkPasswordChange('old-pas', 'new-pass', 'old-pass', false).ok, false);
  // An empty password would turn the lock off at the next restart.
  assert.equal(checkPasswordChange('old-pass', '', 'old-pass', false).ok, false);
  assert.equal(checkPasswordChange('old-pass', '   ', 'old-pass', false).ok, false);
  assert.equal(checkPasswordChange('old-pass', { length: 9 }, 'old-pass', false).ok, false);
  // APP_PASSWORD in the environment wins over the file.
  assert.equal(checkPasswordChange('old-pass', 'new-pass', 'old-pass', true).ok, false);
  // A house with no password yet can set its first one.
  assert.deepEqual(checkPasswordChange(undefined, 'first', '', false), { ok: true });
});
