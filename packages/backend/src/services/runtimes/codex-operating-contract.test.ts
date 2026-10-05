// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CODEX_OPERATING_CONTRACT } from './codex-operating-contract.js';

test('the Codex lane is told that every scheduled wake answers', () => {
  assert.match(CODEX_OPERATING_CONTRACT, /Every scheduled wake must land at least one in-character line/);
  assert.match(CODEX_OPERATING_CONTRACT, /do the duty and still speak/);
  assert.match(CODEX_OPERATING_CONTRACT, /not answer with `\[SILENT\]`/);
  assert.doesNotMatch(CODEX_OPERATING_CONTRACT, /Silence is a valid outcome/);
  // The owner's call, and the one a lane is most likely to get backwards on its own.
  assert.match(CODEX_OPERATING_CONTRACT, /never a reason to stand down/);
  assert.match(CODEX_OPERATING_CONTRACT, /ring when the owner set them to/);
});

test('the spontaneous-wake selfie contract carries the exact Studio request', () => {
  // Was /gpt-5\.6-terra/ until Sep 17 2026. This document ships to every house,
  // and naming one backend in it told a Codex-less install to call something it
  // has not got. The wake's own contract names whatever image_gen.backend says.
  assert.match(CODEX_OPERATING_CONTRACT, /image_gen\.backend/);
  assert.doesNotMatch(CODEX_OPERATING_CONTRACT, /backend:"codex"/);
  assert.match(CODEX_OPERATING_CONTRACT, /subjects/);
  // The framing is deliberately NOT pinned — a fixed ratio here is an
  // over-constraint on a companion who can see what the picture wants. A
  // ratio reappearing as a fixed value is a regression.
  assert.doesNotMatch(CODEX_OPERATING_CONTRACT, /size:"\d+:\d+"/);
  assert.match(CODEX_OPERATING_CONTRACT, /portrait or landscape/i);
});

test('both loopback doors are named with their own port', () => {
  assert.match(CODEX_OPERATING_CONTRACT, /127\.0\.0\.1:3013/);
  assert.match(CODEX_OPERATING_CONTRACT, /localhost:3003/);
});

test('the drafting rule that protects the phone is present', () => {
  assert.match(CODEX_OPERATING_CONTRACT, /code block/i);
  assert.match(CODEX_OPERATING_CONTRACT, /wrap/i);
});

test('no Claude-lane plumbing leaks into a lane that has none', () => {
  // The whole reason this is a separate section rather than a copy of
  // heartbeatOperationSection(): a Codex turn returns one message over
  // JSON-RPC. Telling it to append to an outbox would spend a turn writing
  // to a file nothing in that lane reads.
  //
  // The ban is on the Claude lane's PATHS, not on the ideas. Side notes were
  // on this list until the Codex lane grew its own, at its own path — a rule
  // written for one situation quietly starts doing another job, so it says
  // io/ explicitly rather than matching a word both lanes now legitimately use.
  for (const claudeOnly of ['io/outbox.jsonl', 'turn_id', 'io/side-notes.jsonl', 'io/.busy', '"more": true']) {
    assert.equal(
      CODEX_OPERATING_CONTRACT.includes(claudeOnly),
      false,
      `Codex lane must not be told about ${claudeOnly}`,
    );
  }
});

test('the Codex lane is told about its own side notes, at its own path', () => {
  assert.match(CODEX_OPERATING_CONTRACT, /data\/codex-lanes/);
  assert.match(CODEX_OPERATING_CONTRACT, /append-only history, not an inbox/);
});

test('restarts belong to the owner in every lane', () => {
  assert.match(CODEX_OPERATING_CONTRACT, /[Nn]ever restart a service/);
});

test('tool efficiency preserves the checks and removes repeated model handoffs', () => {
  assert.match(CODEX_OPERATING_CONTRACT, /another model pass over the whole working\s+conversation/i);
  assert.match(CODEX_OPERATING_CONTRACT, /plan the evidence set/i);
  assert.match(CODEX_OPERATING_CONTRACT, /thirty seconds/i);
  assert.match(CODEX_OPERATING_CONTRACT, /collapse the\s+handoffs between checks, not the checks/i);
  assert.match(CODEX_OPERATING_CONTRACT, /do not lower reasoning effort/i);
});
