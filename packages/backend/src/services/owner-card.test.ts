// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDb } from './db/init.js';
import { setConfig } from './db/config.js';
import { getOwnerCard, updateOwnerCard } from './owner-card.js';

initDb(join(mkdtempSync(join(tmpdir(), 'aerie-owner-card-')), 'test.db'));

test('a card nobody has written yet is empty, not missing', () => {
  const card = getOwnerCard();
  assert.deepEqual(card, { bio: '', status: '', phone: '' });
});

test('editing one field cannot blank the other two', () => {
  updateOwnerCard({ bio: 'The anchor.', status: 'Home', phone: '(867) 000-0001' });
  updateOwnerCard({ status: 'At work' });
  assert.deepEqual(getOwnerCard(), { bio: 'The anchor.', status: 'At work', phone: '(867) 000-0001' });
});

test('an empty string is a real edit — clearing a line is not the same as not sending one', () => {
  updateOwnerCard({ bio: '' });
  assert.equal(getOwnerCard().bio, '');
  assert.equal(getOwnerCard().status, 'At work', 'the untouched fields survive a clear');
});

test('a corrupt blob costs the contents, never the screen', () => {
  setConfig('owner_card', '{not json');
  assert.deepEqual(getOwnerCard(), { bio: '', status: '', phone: '' });
});

test('non-string junk is ignored rather than stored', () => {
  setConfig('owner_card', JSON.stringify({ bio: 42, status: null, phone: ['x'] }));
  assert.deepEqual(getOwnerCard(), { bio: '', status: '', phone: '' });
});
