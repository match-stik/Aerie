// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companionPathRefusal } from './companion-paths.js';

const outside = mkdtempSync(join(tmpdir(), 'aerie-outside-'));
const root = mkdtempSync(join(tmpdir(), 'aerie-house-'));
mkdirSync(join(root, 'companions'));
writeFileSync(join(root, 'companions', 'juniper.md'), 'who I am');
writeFileSync(join(root, '.mcp.json'), '{}');
writeFileSync(join(outside, 'secret.md'), 'not for the companion to read');
symlinkSync(join(outside, 'secret.md'), join(root, 'companions', 'sneaky.md'));

test('a companion file inside the house is allowed, absolute or relative', () => {
  assert.equal(companionPathRefusal(join(root, 'companions', 'juniper.md'), 'identity', root), null);
  assert.equal(companionPathRefusal('companions/juniper.md', 'identity', root), null);
  assert.equal(companionPathRefusal('companions/new-one.md', 'identity', root), null, 'not written yet, folder inside');
  assert.equal(companionPathRefusal(join(root, '.mcp.json'), 'mcp', root), null);
  assert.equal(companionPathRefusal(undefined, 'identity', root), null, 'not being changed');
});

test('a path outside the house, through a link, or of the wrong kind is refused (outside review, Nov 20 2026)', () => {
  assert.notEqual(companionPathRefusal(join(outside, 'secret.md'), 'identity', root), null, 'outside');
  assert.notEqual(companionPathRefusal('../' + outside.split('/').pop() + '/secret.md', 'identity', root), null, 'climbing out');
  assert.notEqual(companionPathRefusal(join(root, 'companions', 'sneaky.md'), 'identity', root), null, 'a link pointing out');
  assert.notEqual(companionPathRefusal(join(root, 'aerie.yaml'), 'identity', root), null, 'not markdown');
  assert.notEqual(companionPathRefusal('/home/someone/.codex/auth.json', 'mcp', root), null, 'a login file');
  assert.notEqual(companionPathRefusal('', 'identity', root), null);
});
