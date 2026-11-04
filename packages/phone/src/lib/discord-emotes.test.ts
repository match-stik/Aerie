// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Discord emote tokens in a message come out as pictures at home, and a
// heading line holding only emotes loses its hashes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { discordEmotesToMarkdown } from './discord-emotes.js';

test('a heading line of emotes loses its hashes and draws them big', () => {
  assert.equal(
    discordEmotesToMarkdown('The gentlest end of it:\n# <a:kissing:15> <:makeout:16>'),
    'The gentlest end of it:\n![demoji-big:kissing](https://cdn.discordapp.com/emojis/15.gif?size=48) ![demoji-big:makeout](https://cdn.discordapp.com/emojis/16.png?size=48)',
  );
});

test('an emote inside a sentence is an inline picture, and a heading with words keeps its hashes', () => {
  assert.equal(
    discordEmotesToMarkdown('Look <:bran_behave:9> here\n# Title <:x:1>'),
    'Look ![demoji:bran_behave](https://cdn.discordapp.com/emojis/9.png?size=48) here\n# Title ![demoji:x](https://cdn.discordapp.com/emojis/1.png?size=48)',
  );
});

test('a message with no emotes is handed back untouched', () => {
  assert.equal(discordEmotesToMarkdown('# A real heading\n<not an emote>'), '# A real heading\n<not an emote>');
});
