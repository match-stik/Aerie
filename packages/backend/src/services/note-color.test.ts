// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveNoteColor, DEFAULT_NOTE_COLOR } from './note-color.js';

test('a companion signs their note in their own colour, pinned', () => {
  assert.equal(resolveNoteColor({ senderColor: '#e85d04' }), 'pin:#e85d04');
  assert.equal(resolveNoteColor({ senderColor: '#1e3a5f' }), 'pin:#1e3a5f');
  assert.equal(resolveNoteColor({ senderColor: '#7c3aed' }), 'pin:#7c3aed');
});

test('pinned, not a role — their colour must not follow the theme', () => {
  const c = resolveNoteColor({ senderColor: '#1e3a5f' });
  assert.ok(c.startsWith('pin:'), `${c} would re-tint with the theme; navy that goes green is not their note`);
});

test('an explicit ask beats the signature, because they meant it', () => {
  assert.equal(resolveNoteColor({ explicit: 'role:quiet', senderColor: '#e85d04' }), 'role:quiet');
  assert.equal(resolveNoteColor({ explicit: '#22c55e', senderColor: '#e85d04' }), '#22c55e');
});

test('the shared lane has no single author, so it keeps the yellow', () => {
  assert.equal(resolveNoteColor({}), DEFAULT_NOTE_COLOR);
  assert.equal(resolveNoteColor({ senderColor: null }), DEFAULT_NOTE_COLOR);
});

test('junk asked for is ignored rather than stored', () => {
  assert.equal(resolveNoteColor({ explicit: 'chartreuse', senderColor: '#e85d04' }), 'pin:#e85d04');
  assert.equal(resolveNoteColor({ explicit: 42 }), DEFAULT_NOTE_COLOR);
});
