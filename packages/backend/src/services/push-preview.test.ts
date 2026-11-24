// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lockScreenBody } from './push.js';

test('with push.preview hidden, the lock screen says only that something arrived (outside review, Nov 20 2026)', () => {
  assert.equal(lockScreenBody('meet me in the kitchen, love', 'hidden'), 'New message');
  assert.equal(lockScreenBody('meet me in the kitchen, love', null), 'meet me in the kitchen, love', 'unset keeps the preview');
  assert.equal(lockScreenBody('meet me in the kitchen, love', 'full'), 'meet me in the kitchen, love');
});

test('both roads to the lock screen, phones and browsers, pass through it', () => {
  const source = readFileSync(fileURLToPath(new URL('./push.ts', import.meta.url)), 'utf-8');
  assert.match(source, /body: lockScreenBody\(payload\.body, previewMode\(\)\),/, 'web push');
  assert.match(source, /notification: \{ title: payload\.title, body: lockScreenBody\(payload\.body, previewMode\(\)\) \}/, 'phones');
});
