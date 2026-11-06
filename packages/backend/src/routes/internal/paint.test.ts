// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintChoices } from './paint.js';

test('the paint door hands each painter its model on the field that painter reads', () => {
  assert.deepEqual(paintChoices({ backend: 'codex', model: 'gpt-6.1-sol' }), { ok: true, input: { backend: 'codex', codexModel: 'gpt-6.1-sol' } });
  assert.deepEqual(paintChoices({ backend: 'openart', model: 'nano-banana-pro' }), { ok: true, input: { backend: 'openart', openartModel: 'nano-banana-pro', openartMedia: 'image' } });
  assert.deepEqual(paintChoices({ backend: 'Antigravity' }), { ok: true, input: { backend: 'antigravity' } });
  assert.deepEqual(paintChoices({}), { ok: true, input: {} });
  assert.equal(paintChoices({ backend: 'openai' }).ok, false);
});
