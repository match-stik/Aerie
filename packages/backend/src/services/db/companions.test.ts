// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { initDb } from './init.js';
import { createCompanion, getCompanion, updateCompanion } from './companions.js';

// A real sqlite file in a temp dir: the thing under test is which keys the
// UPDATE actually binds, and a stub would answer that question about the stub.
initDb(join(mkdtempSync(join(tmpdir(), 'aerie-companions-')), 'test.db'));

function fresh(slug: string) {
  return createCompanion({ slug, displayName: slug, claudeMdPath: '/tmp/x.md', mcpJsonPath: '/tmp/x.json' });
}

test('a per-companion model round-trips', () => {
  const c = fresh('modelled');
  assert.equal(getCompanion(c.id)?.model, null, 'starts on the house setting');

  updateCompanion(c.id, { model: 'claude-fable-5' });
  assert.equal(getCompanion(c.id)?.model, 'claude-fable-5');

  updateCompanion(c.id, { model: null });
  assert.equal(getCompanion(c.id)?.model, null, 'clearing it hands them back to the house');
});

test('the wake model binds under BOTH spellings', () => {
  // The camelCase form was the only one bound, so the phone — which reads rows
  // back in the database's own spelling — could send model_autonomous, get a
  // 200 and the whole companion back, and have changed nothing.
  const a = fresh('camel');
  updateCompanion(a.id, { modelAutonomous: 'claude-haiku-4-5' });
  assert.equal(getCompanion(a.id)?.model_autonomous, 'claude-haiku-4-5');

  const b = fresh('snake');
  updateCompanion(b.id, { model_autonomous: 'claude-haiku-4-5' });
  assert.equal(getCompanion(b.id)?.model_autonomous, 'claude-haiku-4-5', 'snake_case must not be silently dropped');
});

test('an update that mentions neither model leaves both alone', () => {
  const c = fresh('untouched');
  updateCompanion(c.id, { model: 'claude-opus-5', modelAutonomous: 'claude-opus-5' });
  updateCompanion(c.id, { bio: 'a change about something else entirely' });
  const after = getCompanion(c.id);
  assert.equal(after?.model, 'claude-opus-5');
  assert.equal(after?.model_autonomous, 'claude-opus-5');
  assert.equal(after?.bio, 'a change about something else entirely');
});
