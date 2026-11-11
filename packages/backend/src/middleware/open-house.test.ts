// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedHostsFrom, isLoopbackBind, openHouseGuard, openHouseHostAllowed } from './open-house.js';

test('only a loopback bind counts as this machine alone', () => {
  for (const h of ['127.0.0.1', 'localhost', '::1', ' LOCALHOST ']) assert.equal(isLoopbackBind(h), true, h);
  for (const h of ['0.0.0.0', '100.64.0.1', '192.168.1.5', '', undefined]) assert.equal(isLoopbackBind(h), false, String(h));
});

test('a house with no password answers its own address and its configured origins', () => {
  const allowed = allowedHostsFrom(['https://house.example.net', 'not a url']);
  assert.equal(openHouseHostAllowed('127.0.0.1:3002', allowed), true);
  assert.equal(openHouseHostAllowed('localhost', allowed), true);
  assert.equal(openHouseHostAllowed('house.example.net', allowed), true);
  assert.equal(openHouseHostAllowed('rebind.example:3002', allowed), false, 'a rebound hostname is refused');
});

test('the guard steps aside once a password is set', () => {
  const allowed = allowedHostsFrom([]);
  const run = (hasPassword: boolean, host: string) => {
    let passed = false;
    let status = 0;
    const res = { status(code: number) { status = code; return { json() { /* refused */ } }; } };
    openHouseGuard(() => hasPassword, allowed)(
      { headers: { host }, method: 'GET', originalUrl: '/api/threads' } as never,
      res as never,
      () => { passed = true; },
    );
    return { passed, status };
  };
  assert.deepEqual(run(false, 'rebind.example:3002'), { passed: false, status: 421 });
  assert.deepEqual(run(false, '127.0.0.1:3002'), { passed: true, status: 0 });
  assert.deepEqual(run(true, 'rebind.example:3002'), { passed: true, status: 0 });
});
