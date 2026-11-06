// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directLocalCheck } from './internal-guard.js';

const local = (headers: Record<string, unknown>) => directLocalCheck({ socket: { remoteAddress: '127.0.0.1' }, headers });

test('our own loopback calls still pass, by any loopback name', () => {
  for (const host of ['127.0.0.1:3013', 'localhost:3003', '[::1]:3013', '127.0.0.1', 'LOCALHOST']) {
    assert.deepEqual(local({ host }), { ok: true }, host);
  }
  assert.deepEqual(local({}), { ok: true });
});

test('a rebound hostname on a loopback socket is refused', () => {
  // DNS rebinding: the socket is loopback and no proxy header is set, but the
  // browser still sends the page's own hostname.
  const verdict = local({ host: 'evil.example:3013' });
  assert.equal(verdict.ok, false);
  assert.equal(local({ host: '127.0.0.1.evil.example' }).ok, false);
});

test('proxy headers and remote sockets are still refused', () => {
  assert.equal(local({ host: '127.0.0.1:3013', 'x-forwarded-for': '1.2.3.4' }).ok, false);
  assert.equal(directLocalCheck({ socket: { remoteAddress: '10.0.0.5' }, headers: { host: '127.0.0.1' } }).ok, false);
});
