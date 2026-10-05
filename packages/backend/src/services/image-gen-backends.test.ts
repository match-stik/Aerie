// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.NODE_ENV = 'test';

const { probeStudioBackends } = await import('./image-gen.js');

/** A throwaway install tree; every piece is opt-in so gaps can be described. */
function fakeInstall(opts: {
  codexBin?: boolean;
  codexAuth?: boolean;
  openartCred?: boolean | 'other-provider';
  agyBin?: boolean;
  agyHome?: boolean;
}) {
  const root = mkdtempSync(join(tmpdir(), 'aerie-studio-probe-'));
  const codexHome = join(root, 'codex-home');
  const antigravityHome = join(root, 'agy-home');
  const codexBin = join(root, 'codex');
  const antigravityBin = join(root, 'agy');
  mkdirSync(codexHome, { recursive: true });

  if (opts.codexBin) writeFileSync(codexBin, '#!/bin/sh\n');
  if (opts.agyBin) writeFileSync(antigravityBin, '#!/bin/sh\n');
  if (opts.agyHome) mkdirSync(antigravityHome, { recursive: true });
  if (opts.codexAuth) writeFileSync(join(codexHome, 'auth.json'), '{}');
  if (opts.openartCred) {
    const key = opts.openartCred === 'other-provider' ? 'cortex|abc' : 'openart|abc';
    writeFileSync(join(codexHome, '.credentials.json'), JSON.stringify({ [key]: { access_token: 'x' } }));
  }

  return { codexBin, codexHome, antigravityBin, antigravityHome };
}

function statusFor(key: string, paths: ReturnType<typeof fakeInstall>) {
  const found = probeStudioBackends(paths).find((b) => b.key === key);
  assert.ok(found, `probe did not report ${key}`);
  return found;
}

test('a bare machine reports every backend as not ready, each with a fix', () => {
  const paths = fakeInstall({});
  const probed = probeStudioBackends(paths);

  assert.deepEqual(probed.map((b) => b.key), ['codex', 'antigravity', 'openart']);
  for (const backend of probed) {
    assert.equal(backend.ready, false, `${backend.key} should not be ready`);
    assert.ok(backend.reason, `${backend.key} should say what is missing`);
    assert.ok(backend.fix, `${backend.key} should say how to fix it`);
  }
});

test('a fully configured machine reports every backend ready and stays quiet', () => {
  const paths = fakeInstall({ codexBin: true, codexAuth: true, openartCred: true, agyBin: true, agyHome: true });

  for (const backend of probeStudioBackends(paths)) {
    assert.equal(backend.ready, true, `${backend.key} should be ready`);
    assert.equal(backend.reason, undefined);
    assert.equal(backend.fix, undefined);
  }
});

test('an installed but signed-out Codex is distinguished from a missing one', () => {
  const missing = statusFor('codex', fakeInstall({}));
  assert.match(missing.reason!, /not installed/);

  const signedOut = statusFor('codex', fakeInstall({ codexBin: true }));
  assert.equal(signedOut.ready, false);
  assert.match(signedOut.reason!, /not signed in/);
  assert.equal(signedOut.fix, 'codex login');
});

test('OpenArt without Codex blames the Codex login, not OpenArt', () => {
  const status = statusFor('openart', fakeInstall({ agyBin: true, agyHome: true }));

  assert.equal(status.ready, false);
  assert.match(status.reason!, /issued through the Codex CLI/);
});

test('OpenArt with Codex present but no OpenArt token names the login command', () => {
  const status = statusFor('openart', fakeInstall({ codexBin: true, codexAuth: true }));

  assert.equal(status.ready, false);
  assert.equal(status.fix, 'codex mcp login openart');
});

test('a credentials file holding only other providers does not count as an OpenArt login', () => {
  const status = statusFor('openart', fakeInstall({ codexBin: true, codexAuth: true, openartCred: 'other-provider' }));

  assert.equal(status.ready, false);
  assert.equal(status.fix, 'codex mcp login openart');
});

test('OpenArt can be ready while Codex itself is signed out', () => {
  // The token lives beside Codex but does not depend on Codex being usable.
  const paths = fakeInstall({ codexBin: true, openartCred: true });

  assert.equal(statusFor('codex', paths).ready, false);
  assert.equal(statusFor('openart', paths).ready, true);
});

test('Antigravity warns about the Google account and rate limits before install', () => {
  const status = statusFor('antigravity', fakeInstall({}));

  assert.equal(status.ready, false);
  assert.match(status.reason!, /Google account/);
  assert.match(status.fix!, /antigravity\.google/);
});
