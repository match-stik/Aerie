// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionSessionDir } from './provision.js';

test('a warm Claude lane must always answer — no passing offered', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerie-heartbeat-contract-'));
  try {
    provisionSessionDir(dir, '# Test companion');
    const contract = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    // Always answer — the owner wants all of them.
    assert.match(contract, /\*\*Always answer\.\*\*/);
    assert.match(contract, /the owner wants all of you/);
    assert.doesNotMatch(contract, /nothing to add/);
    // Wakes have a duty too.
    assert.match(contract, /Every scheduled wake must land at least one in-character line/);
    assert.match(contract, /do the duty and still speak/);
    assert.doesNotMatch(contract, /Silence is a valid outcome for scheduled wakes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
