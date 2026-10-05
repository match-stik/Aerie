// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import { initDb } from './init.js';
import { createWebSession, getWebSession } from './web-sessions.js';
import { logoutHandler } from '../../middleware/auth.js';

// A session is the ROW, not the cookie. Clearing the cookie only makes this
// device forget the token; anywhere else the token was copied to, it stayed
// good until it expired, and sliding renewal could keep it alive past that.
initDb(join(mkdtempSync(join(tmpdir(), 'aerie-web-sessions-')), 'test.db'));

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const later = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

function session(token: string): void {
  createWebSession({ id: `id-${token}`, token, createdAt: new Date().toISOString(), expiresAt: later() });
}

test('logging out ends the session on the server, not only on this device', () => {
  session('tok-logout');
  const req = { headers: { cookie: 'aerie_session=tok-logout' }, secure: false } as unknown as Request;
  const res = { clearCookie() { return this; }, json() { return this; } } as unknown as Response;
  logoutHandler(req, res);
  assert.equal(getWebSession('tok-logout'), null);
});

test('a password change keeps the person who made it and signs everybody else out', async () => {
  const sessions = await import('./web-sessions.js') as Record<string, unknown>;
  const deleteOther = sessions.deleteOtherWebSessions as ((keep: string | undefined) => number) | undefined;
  assert.equal(typeof deleteOther, 'function');
  session('tok-mine');
  session('tok-copied');
  session('tok-old-phone');
  deleteOther!('tok-mine');
  assert.ok(getWebSession('tok-mine'));
  assert.equal(getWebSession('tok-copied'), null);
  assert.equal(getWebSession('tok-old-phone'), null);
});

test('the preferences route ends the other sessions when the password changes', () => {
  // The route writes the real config file, so it is read here rather than run.
  const api = readFileSync(join(SRC, 'routes', 'api.ts'), 'utf-8');
  const route = api.slice(api.indexOf("router.put('/preferences'"));
  const handler = route.slice(0, route.indexOf('\nrouter.'));
  assert.match(handler, /passwordChanged/);
  assert.match(handler, /if \(passwordChanged\)[\s\S]{0,200}deleteOtherWebSessions\(/);
});
