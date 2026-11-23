// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { identityFilesLine } from './identity-files.js';

test('a house with companions names their files and the shared base, not the old CLAUDE.md', () => {
  const have = new Set(['/h/companions/_shared.md', '/h/companions/juniper.md', '/h/companions/rowan.md']);
  const line = identityFilesLine(['/h/companions/juniper.md', '/h/companions/rowan.md', '/h/companions/alex.md'], ['/h/CLAUDE.md'], (p) => have.has(p));
  assert.equal(line, '/h/companions/ _shared.md, juniper.md, rowan.md, alex.md (missing)');
});

test('a house with no companions still falls back to the single CLAUDE.md, or nothing', () => {
  assert.equal(identityFilesLine([], ['/h/a.md', '/h/CLAUDE.md'], (p) => p === '/h/CLAUDE.md'), '/h/CLAUDE.md');
  assert.equal(identityFilesLine([], ['/h/CLAUDE.md'], () => false), null);
});
