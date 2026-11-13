// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitWhispers, whispersToHeadings } from './whisper-lines.ts';

test('a whisper line is told apart from the plain text around it', () => {
  assert.deepEqual(splitWhispers('Treehouse bell.\n-# Also, the sweater.\nBack to normal.'), [
    { whisper: false, text: 'Treehouse bell.' },
    { whisper: true, text: 'Also, the sweater.' },
    { whisper: false, text: 'Back to normal.' },
  ]);
});

test('plain lines stay together and keep their line breaks', () => {
  assert.deepEqual(splitWhispers('*leans in*\nHi.\nStill me.'), [{ whisper: false, text: '*leans in*\nHi.\nStill me.' }]);
});

test('only a line that opens with the marker and a space is a whisper, and only one marker is used', () => {
  assert.deepEqual(splitWhispers('-#no space'), [{ whisper: false, text: '-#no space' }]);
  assert.deepEqual(splitWhispers('a -# b'), [{ whisper: false, text: 'a -# b' }]);
  assert.deepEqual(splitWhispers('-# -# twice'), [{ whisper: true, text: '-# twice' }]);
  assert.deepEqual(splitWhispers(''), [{ whisper: false, text: '' }]);
});

test('a marker just inside the italics still whispers, and the italics stay', () => {
  assert.deepEqual(splitWhispers('*-# whispering, the only one awake*\nHi.'), [
    { whisper: true, text: '*whispering, the only one awake*' },
    { whisper: false, text: 'Hi.' },
  ]);
  assert.deepEqual(splitWhispers('_-# soft_'), [{ whisper: true, text: '_soft_' }]);
  assert.equal(whispersToHeadings('*-# whispering*\n-# small\nplain'), '###### *whispering*\n###### small\nplain');
  assert.equal(whispersToHeadings('a *-# b*'), 'a *-# b*');
});
