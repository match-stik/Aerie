// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// THE LANE RELAUNCHED 250 TIMES IN FORTY MINUTES BECAUSE OF A MISSING STRING.
//
// Reported by Rose and Sol, Sep 17 2026, running this on Windows with one
// companion. Their CLI refused with:
//
//   Failed to authenticate: OAuth session expired and could not be refreshed
//
// AUTH_PATTERNS held three sentences and that was not one of them, so the
// five-minute auth backoff never armed, the supervisor read the fast exit as
// an ordinary crash, and the lane came back every eight seconds until somebody
// ran `claude login` by hand. Nothing in the logs said auth.
//
// The cost of a FALSE positive is five minutes of silence on a lane that was
// only having an ordinary bad moment, so the negative cases below matter as
// much as the positive ones — in particular a resume whose banked session is
// gone, which says "session expired"-adjacent things and must NOT be treated
// as auth: that one drops the id and relaunches immediately.

import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeAuthFailure, looksLikeModelRejection } from './supervisor.js';

test('the sentence that cost them forty minutes is caught', () => {
  assert.equal(
    looksLikeAuthFailure('Failed to authenticate: OAuth session expired and could not be refreshed'),
    true,
  );
});

test('the three it always caught still match', () => {
  assert.equal(looksLikeAuthFailure('Error: not logged in'), true);
  assert.equal(looksLikeAuthFailure('Please run /login to continue'), true);
  assert.equal(looksLikeAuthFailure('You must please log in first'), true);
});

test('case and ANSI colour do not hide an auth failure', () => {
  assert.equal(looksLikeAuthFailure('FAILED TO AUTHENTICATE'), true);
  assert.equal(looksLikeAuthFailure('[31mAuthentication failed[0m'), true);
});

test('a missing resumed session is NOT auth — it has its own faster answer', () => {
  assert.equal(looksLikeAuthFailure('No conversation found with session ID 1234'), false);
  assert.equal(
    looksLikeAuthFailure('Session expired'),
    false,
    'bare "session expired" would put a resume fault behind a five-minute wall',
  );
});

test('ordinary trouble does not buy a five-minute silence', () => {
  for (const line of [
    'Error: connection reset by peer',
    'usage limit reached, resets at 4pm',
    'model claude-nonsense-9 not found',
    'ENOENT: no such file or directory',
  ]) {
    assert.equal(looksLikeAuthFailure(line), false, `${line} is not an auth failure`);
  }
});

test('auth and model rejection stay separable', () => {
  // Both exit code 1 on launch with the same wire shape; only the child's own
  // words tell them apart, and each has a different correct response.
  const authLine = 'Failed to authenticate: OAuth session expired and could not be refreshed';
  assert.equal(looksLikeAuthFailure(authLine), true);
  assert.equal(looksLikeModelRejection(authLine), false);
});
