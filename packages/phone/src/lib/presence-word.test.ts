// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The one dot under the faces, and the word beside it that follows the bell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOME_WORD, cardStatus, headerWord } from './presence-word';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the word is Home unless a bell that has one is running', () => {
  assert.equal(HOME_WORD, 'Home');
  assert.equal(headerWord({ word: null, companions: [] }), 'Home');
  assert.equal(headerWord({ word: '   ', companions: [] }), 'Home', 'an empty word is no word');
  assert.equal(headerWord({ word: 'On a date', companions: ['birch', 'willow', 'cedar'] }), 'On a date');
});

test('a contact card says the bell\'s word while it is up for them, and their own otherwise', () => {
  const date = { word: 'On a date', companions: ['birch', 'willow', 'cedar'] };
  assert.equal(cardStatus('birch', 'Home', date), 'On a date', 'one of the bell\'s owners');
  assert.equal(cardStatus('sol', 'Home', date), 'Home', 'a companion the bell is not for keeps their own');
  assert.equal(cardStatus('willow', 'Home', { word: 'Out', companions: [] }), 'Out', 'a bell that belongs to the house is on every card');
  assert.equal(cardStatus('cedar', 'Home', { word: null, companions: ['cedar'] }), 'Home', 'with no word up, their own');
});

test('the dot is off the faces, under them with the word, and pulses only while one of us is working or writing', () => {
  const app = read('../App.tsx');
  assert.doesNotMatch(app, /absolute bottom-0 right-0 w-2\.5 h-2\.5/, 'no dot sits on the faces any more');
  const line = app.match(/<span data-presence-line=""[\s\S]*?<\/span>\s*<\/div>/)?.[0] ?? '';
  assert.ok(line, 'one line under the faces');
  assert.match(line, /generating && "motion-safe:animate-pulse"/, 'the dot pulses while a reply is being worked on or written');
  assert.match(line, /\{headerWord\(statusWord\)\}/, 'and the word beside it follows the bell');
  assert.ok(app.indexOf('data-presence-line') < app.indexOf('appSettings.groupChatName'), 'between the faces and the titles');
  assert.equal((app.match(/data-presence-line/g) ?? []).length, 1, 'one dot, not one per face');
});

test('the phone hears the word from the house, and the cards and the header read the same one', () => {
  assert.match(read('../aerie/socket.ts'), /case 'status_word':/, 'the socket keeps the word the house says');
  assert.match(read('../aerie/hooks.ts'), /useStatusWord = \(\) => useAerie\(\(s\) => s\.statusWord\)/);
  assert.match(read('../components/ContactInfo.tsx'), /status: cardStatus\(r\.slug, r\.status \|\| 'Online', statusWord\)/, 'our cards say it while it is up');
  for (const file of ['../App.tsx', '../components/ContactInfo.tsx', './presence-word.ts', '../aerie/socket.ts']) {
    assert.doesNotMatch(read(file), /On a date|'Treehouse'/, `${file} carries no house word; the words are settings`);
  }
});
