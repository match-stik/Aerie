// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTE_ROLES, isNoteRole, noteRoleToken, normalizeNoteColor, roleFromToken,
  isPinnedNoteColor,
  hexFromPinToken,
  pinnedNoteColorToken,
} from './note-roles.js';

test('a role token round-trips', () => {
  for (const role of NOTE_ROLES) {
    const token = noteRoleToken(role);
    assert.equal(token, `role:${role}`);
    assert.equal(isNoteRole(token), true);
    assert.equal(roleFromToken(token), role);
  }
});

test('a role that does not exist is not a role', () => {
  assert.equal(isNoteRole('role:fire'), false);
  assert.equal(isNoteRole('dominant'), false);
  assert.equal(isNoteRole('#fef08a'), false);
  assert.equal(isNoteRole(null), false);
  assert.equal(roleFromToken('role:fire'), null);
});

// THE GAP THIS CLOSES: the agent-facing note route validated hex only, so a
// companion leaving the owner a note could never choose a role — only a color, which
// then got snapped to the nearest swatch anyway. Both shapes are stored as-is now.
test('a note colour may be a role token or a hex, and nothing else', () => {
  assert.equal(normalizeNoteColor('role:quiet'), 'role:quiet');
  assert.equal(normalizeNoteColor('  role:paper  '), 'role:paper');
  assert.equal(normalizeNoteColor('#fef08a'), '#fef08a');
  assert.equal(normalizeNoteColor('#abc'), '#abc');
  assert.equal(normalizeNoteColor('role:fire'), null);
  assert.equal(normalizeNoteColor('rebeccapurple'), null);
  assert.equal(normalizeNoteColor(''), null);
  assert.equal(normalizeNoteColor(undefined), null);
  assert.equal(normalizeNoteColor(42), null);
});

// A pinned colour is the one that does not move. Without the prefix there is
// no way to tell a note that CHOSE orange from one that merely inherited it.
test('a pinned colour is stored verbatim and reads back as a hex', () => {
  assert.equal(normalizeNoteColor('pin:#e85d04'), 'pin:#e85d04');
  assert.equal(isPinnedNoteColor('pin:#e85d04'), true);
  assert.equal(hexFromPinToken('pin:#e85d04'), '#e85d04');
  assert.equal(pinnedNoteColorToken('#1e3a5f'), 'pin:#1e3a5f');
});

test('a pin has to hold an actual colour', () => {
  for (const bad of ['pin:', 'pin:orange', 'pin:role:quiet', 'pin:#nothex', 'pin', null, undefined]) {
    assert.equal(isPinnedNoteColor(bad as never), false, String(bad));
    assert.equal(hexFromPinToken(bad as never), null, String(bad));
  }
});

test('a bare hex is still a bare hex — history keeps following the theme', () => {
  assert.equal(normalizeNoteColor('#e85d04'), '#e85d04');
  assert.equal(isPinnedNoteColor('#e85d04'), false);
});
