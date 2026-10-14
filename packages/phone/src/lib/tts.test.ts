// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanForTTS } from './tts';

test('inline code is spoken without its backtick delimiters', () => {
  assert.equal(
    cleanForTTS('Like, subscribe, and enable `user_read`.'),
    'Like, subscribe, and enable user_read.',
  );
});

test('fenced code remains silent while surrounding inline code is spoken', () => {
  assert.equal(
    cleanForTTS([
      'Enable `user_read` first.',
      '```ts',
      'const secret = `do not speak this`;',
      '```',
      'Then enable `text_to_speech`.',
    ].join('\n')),
    'Enable user_read first.\n\nThen enable text_to_speech.',
  );
});
