// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isStageDirection, prepareTextForTTS } from './tts-text.js';

test('inline code is spoken without its backtick delimiters', () => {
  assert.equal(
    prepareTextForTTS('Like, subscribe, and enable `user_read`.'),
    'Like, subscribe, and enable user underscore read.',
  );
});

test('a path inside inline code is spoken the way a person says it', () => {
  assert.equal(
    prepareTextForTTS('It was handed the raw path `packages/frontend`.'),
    'It was handed the raw path packages slash frontend.',
  );
});

test('inline code carrying no separators is left exactly as written', () => {
  assert.equal(
    prepareTextForTTS('Run `npm test` and read the count.'),
    'Run npm test and read the count.',
  );
});

test('fenced code remains silent while surrounding inline code is spoken', () => {
  assert.equal(
    prepareTextForTTS([
      'Enable `user_read` first.',
      '```ts',
      'const secret = `do not speak this`;',
      '```',
      'Then enable `text_to_speech`.',
    ].join('\n')),
    'Enable user underscore read first.\n\nThen enable text underscore to underscore speech.',
  );
});

test('a stage direction shapes the voice without being read out', () => {
  const line = [
    '*low, across the table*',
    'There she is.',
  ].join('\n');

  // Default: a direction fires its cue and keeps its words out of the audio.
  const output = prepareTextForTTS(line);
  assert.match(output, /\[low and intimate\]/);
  assert.doesNotMatch(output, /across the table/);
  assert.match(output, /There she is\./);
  // Read aloud, the same line keeps its cue AND says the words.
  const read = prepareTextForTTS(line, { readActionsAloud: true });
  assert.match(read, /\[low and intimate\]/);
  assert.match(read, /across the table/);
});

test('an aside keeps its cue and its words', () => {
  const line = '*quiet, and I mean this*';
  const spoken = prepareTextForTTS(line);
  assert.match(spoken, /\[softly\]/);
  assert.match(spoken, /quiet, and I mean this\./);
});

test('speaking actions leaves inline emphasis and dialogue untouched', () => {
  const line = 'That is *ours*.';
  assert.equal(prepareTextForTTS(line), 'That is ours.');
});

test('a stage direction with no matching cue stays silent so the voice performs it', () => {
  const line = '*sets the spoon down on the table*';
  assert.equal(prepareTextForTTS(line), '');
  // ...and reading actions aloud is the position that gets those words back.
  assert.equal(prepareTextForTTS(line, { readActionsAloud: true }), 'sets the spoon down on the table.');
});

test('an aside written in the same italics is spoken in full', () => {
  const line = '*went and read it rather than tell you what our wall says*';
  // No position drops an aside -- that is the whole point of there being two.
  for (const opts of [{}, { readActionsAloud: true }]) {
    assert.equal(prepareTextForTTS(line, opts), 'went and read it rather than tell you what our wall says.');
  }
});

test('stage directions and asides are told apart by how the house writes them', () => {
  // Third person, subjectless present tense, body parts, bare delivery notes.
  for (const direction of [
    'settles',
    "doesn't move an inch",
    'hand still flat on your shoulder',
    'low',
    'low, across the table',
    'clipped, wrecked',
    'half a smile',
    'and he does not rush a single one of them',
    // Second person, but as the OBJECT -- the subject is still the hand.
    "catches it before you've finished making it",
    'thumb tracing your initials on the mug',
  ]) {
    assert.equal(isStageDirection(direction), true, `expected a direction: ${direction}`);
  }

  // First person, past tense, questions, and anything said straight at the user.
  for (const aside of [
    'I ran it both ways rather than answer you from memory',
    'went and checked what that means for the ones you have already played',
    'so — what is it? Tell us the original plan first',
    "didn't need the question mark, starling",
    'from that list — one thing, darling',
    // Found in the wild: talking to the user ABOUT another companion. The third person is
    // real, but the subject is the user, so it is speech.
    'you followed the sign he nailed to the door',
    "you've been hearing us with half our voices cut out",
  ]) {
    assert.equal(isStageDirection(aside), false, `expected an aside: ${aside}`);
  }
});

test('an unrecognisable line is spoken rather than silently dropped', () => {
  // The bias that matters: speaking an action costs characters, silencing an
  // aside costs authored words, so anything the rules cannot place is heard.
  assert.equal(isStageDirection('the fail2ban half went with it — no door left to guard'), false);
});
