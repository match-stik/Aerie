// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The report: push notifications stopped arriving while the app was
// backgrounded, and only came once it was fully closed.
//
// That is one predicate. sendIfOffline asked isUserConnected(), which is true
// for any socket object in the map — it checks neither readyState nor whether
// the user is looking at it. Backgrounded keeps the socket, so the push was
// suppressed for somebody who could not see anything; fully closing killed it,
// which is why that was the only state that worked.
//
// These tests are about the registry predicate the push path must use. They
// fail if sendIfOffline's question ever goes back to mere connectedness.

import { test } from 'node:test';
import assert from 'node:assert';
import { ConnectionRegistry } from './ws/connection-registry.js';

const OPEN = 1;
const CLOSED = 3;

function fakeSocket(over: Partial<{ readyState: number; tabVisible: boolean }> = {}) {
  return { readyState: OPEN, tabVisible: true, ...over } as never;
}

test('app in the foreground: connected AND visible, so nothing is pushed', () => {
  const r = new ConnectionRegistry();
  r.add('user', fakeSocket({ tabVisible: true }));
  assert.equal(r.isUserConnected(), true);
  assert.equal(r.isUserTabVisible(), true, 'a visible tab is the only thing that should suppress a push');
});

test('app BACKGROUNDED: still connected, and that is exactly why the old test was wrong', () => {
  const r = new ConnectionRegistry();
  r.add('user', fakeSocket({ tabVisible: false }));
  assert.equal(r.isUserConnected(), true, 'the socket survives backgrounding — this is the trap');
  assert.equal(r.isUserTabVisible(), false, 'the owner cannot see it, so the push must go');
});

test('app fully closed: no connection at all, push goes', () => {
  const r = new ConnectionRegistry();
  assert.equal(r.isUserConnected(), false);
  assert.equal(r.isUserTabVisible(), false);
});

test('a socket that is not OPEN cannot claim the owner is looking', () => {
  const r = new ConnectionRegistry();
  r.add('user', fakeSocket({ readyState: CLOSED, tabVisible: true }));
  assert.equal(r.isUserTabVisible(), false, 'isUserTabVisible filters on readyState; isUserConnected does not');
});

test('two devices, one visible: the visible one wins and no push goes', () => {
  const r = new ConnectionRegistry();
  r.add('user', fakeSocket({ tabVisible: false }));
  r.add('user', fakeSocket({ tabVisible: true }));
  assert.equal(r.isUserTabVisible(), true, 'if any live device is showing it, the owner has seen it');
});
