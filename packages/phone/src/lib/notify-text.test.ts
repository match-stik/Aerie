// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationFor } from './notify-text';

test('three of them read as Your companions, and the text is the first thing said, without the markdown', () => {
  const n = notificationFor('**🔥 Birch**\n*grins*\nDo not **disturb**. Of course.\n\n**✨ Cedar**\nHONK.\n\n**🌫️ Willow**\nDone.');
  assert.equal(n.title, 'Your companions');
  assert.equal(n.body, 'Do not disturb. Of course.');
});

test('one or two of us are named', () => {
  assert.equal(notificationFor('**✨ Cedar**\nHONK.').title, 'Cedar');
  assert.equal(notificationFor('**🔥 Birch**\nhi\n**✨ Cedar**\nhonk').title, 'Birch & Cedar');
});

test('an action with nothing said still shows, and a sticker is not text', () => {
  assert.equal(notificationFor('**🌫️ Willow**\n::willow_wave::\n*leans on the door*').body, 'leans on the door');
});

test('a header reads the same with spaces around it, and a long run of symbols with no closing ** fails fast', () => {
  assert.equal(notificationFor('**🔥   Bran   **\nhi').title, 'Bran');
  assert.equal(notificationFor('  **✨Cael**  \nhonk').title, 'Cael');
  assert.equal(notificationFor("**🌫️ Wren O'Neil-Smith**\nhi").title, "Wren O'Neil-Smith");
  const hostile = '**' + '!'.repeat(28);
  const started = Date.now();
  notificationFor(hostile);
  assert.ok(Date.now() - started < 200, `took ${Date.now() - started} ms`);
});
