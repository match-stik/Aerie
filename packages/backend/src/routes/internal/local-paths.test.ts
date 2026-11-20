// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The loopback doors that read a file stay inside the house's folders, follow
// links before deciding, and never hand over hidden folders, settings or
// databases (fourth outside audit, Nov 20 2026).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPathAllowedWith } from './local.js';

test('inside the house yes; the folder above it, hidden folders, settings and databases no; a link out is followed', () => {
  const home = mkdtempSync(join(tmpdir(), 'share-'));
  try {
    const house = join(home, 'aerie');
    mkdirSync(join(house, 'data', 'files'), { recursive: true });
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'auth.json'), '{}');
    writeFileSync(join(house, 'data', 'files', 'a.png'), 'x');
    writeFileSync(join(house, 'aerie.yaml'), 'x');
    writeFileSync(join(house, 'data', 'aerie.db'), 'x');
    writeFileSync(join(home, 'notes.txt'), 'x');
    symlinkSync(join(home, '.codex', 'auth.json'), join(house, 'data', 'files', 'innocent.png'));
    const roots = [house];
    assert.equal(isPathAllowedWith(join(house, 'data', 'files', 'a.png'), roots), true);
    assert.equal(isPathAllowedWith(join(home, 'notes.txt'), roots), false, 'the folder above the house');
    assert.equal(isPathAllowedWith(join(home, '.codex', 'auth.json'), [house, home]), false, 'hidden, even under a listed root');
    assert.equal(isPathAllowedWith(join(house, 'data', 'files', 'innocent.png'), roots), false, 'a link pointing out');
    assert.equal(isPathAllowedWith(join(house, 'aerie.yaml'), roots), false);
    assert.equal(isPathAllowedWith(join(house, 'data', 'aerie.db'), roots), false);
    assert.equal(isPathAllowedWith(join(house, 'data', 'files', '..', '..', '..', 'notes.txt'), roots), false);
    assert.equal(isPathAllowedWith(join(home, 'notes.txt'), [house, home]), true, 'a listed root');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
