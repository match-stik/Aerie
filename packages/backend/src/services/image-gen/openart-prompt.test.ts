// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// OpenArt gets the reference preamble the Codex painter always had.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openartPrompt } from './openart.js';

test('a picture is told who each reference is and to take only the face from it', () => {
  const out = openartPrompt('Three men in a kitchen.', 'image', ['Cedar', 'Willow', 'Birch'], ['cedar', 'willow', 'birch'], '  - Sam: 5\'7"');
  assert.match(out, /1\. Cedar\n {2}2\. Willow\n {2}3\. Birch/);
  assert.match(out, /IDENTITY ONLY/);
  assert.match(out, /Do NOT inherit its pose, head angle, gaze, expression/);
  assert.match(out, /Sam: 5'7"/);
  assert.ok(out.endsWith('Three men in a kitchen.'));
});

test('no references and no notes leaves the prompt as it is, and a video keeps its bare prompt', () => {
  assert.equal(openartPrompt('A field.', 'image', [], undefined, ''), 'A field.');
  assert.equal(openartPrompt('Walk forward.', 'video', ['Birch'], ['birch'], 'note'), 'Walk forward.');
});
