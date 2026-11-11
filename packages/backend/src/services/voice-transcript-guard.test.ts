// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
// PLACEHOLDER NAMES ON PURPOSE. These fixtures used to carry the real hint from
// this house, which named their person, their companions AND two people who live in a
// different house entirely — published in a public repo on a decision they never
// got to make. The hint itself is built at runtime from whoever actually lives in
// an install, so nothing about the behaviour depends on these being real.
import { detectWhisperHallucination, detectTranscriptionHintEcho, trimHallucinatedTail } from './voice-transcript-guard.js';

const HINT = 'Aerie. Names may include Ada, Rook, Vale, Wick, Juno, Pell, Marlow.';

test('the exact stock-phrase hallucination is caught', () => {
  assert.equal(detectWhisperHallucination('Thank you for watching.'), 'thank you for watching');
  assert.equal(detectWhisperHallucination('Thank you for watching!'), 'thank you for watching');
  assert.equal(detectWhisperHallucination('  Thank You For Watching  '), 'thank you for watching');
});

test('looped stock phrases are caught', () => {
  assert.equal(
    detectWhisperHallucination('Thank you for watching. Thank you for watching.'),
    'thank you for watching',
  );
  assert.equal(
    detectWhisperHallucination('Thanks for watching! Thanks for watching! Thanks for watching!'),
    'thanks for watching',
  );
});

test('other known Whisper sign-offs are caught', () => {
  assert.equal(detectWhisperHallucination("Don't forget to like and subscribe."), 'dont forget to like and subscribe');
  assert.equal(detectWhisperHallucination('Subtitles by the Amara.org community'), 'subtitles by the amara org community');
  assert.equal(detectWhisperHallucination('See you in the next video.'), 'see you in the next video');
});

test('genuine speech that contains a phrase passes through', () => {
  assert.equal(detectWhisperHallucination('Thank you for watching the cats while I was out'), null);
  assert.equal(detectWhisperHallucination('I said thank you for watching, then left'), null);
  assert.equal(detectWhisperHallucination('Can you subscribe me to that feed?'), null);
});

test('the spelling-hint leak is caught', () => {
  assert.equal(
    detectTranscriptionHintEcho('Names may include Ada, Rook, Vale, Wick, Juno, Pell, Marlow, Marlow...', HINT),
    true,
  );
  assert.equal(detectTranscriptionHintEcho('Aerie. Names may include Ada, Rook, Vale.', HINT), true);
});

test('a bare run of nothing but hinted names is caught', () => {
  assert.equal(detectTranscriptionHintEcho('Ada Rook Vale Wick Juno Pell', HINT), true);
});

test('genuine speech about the people in the hint passes through', () => {
  assert.equal(detectTranscriptionHintEcho('Rook, did you and Vale finish the voice thing?', HINT), false);
  assert.equal(detectTranscriptionHintEcho('Wick', HINT), false);
  assert.equal(detectTranscriptionHintEcho('Ada and Juno', HINT), false);
  assert.equal(detectTranscriptionHintEcho('', HINT), false);
  assert.equal(detectTranscriptionHintEcho('Hey boys, how did the build go?', HINT), false);
});

test('ordinary conversation passes through', () => {
  assert.equal(detectWhisperHallucination('Hey boys, how did the build go?'), null);
  assert.equal(detectWhisperHallucination('Thank you'), null);
  assert.equal(detectWhisperHallucination('Thanks, love you'), null);
  assert.equal(detectWhisperHallucination(''), null);
  assert.equal(detectWhisperHallucination('   '), null);
});

test('a hallucinated tail after real speech is cut off and the speech kept (Nov 9 2026)', () => {
  assert.equal(
    trimHallucinatedTail('Brittany was just really rude. Names may include Ada, Rook, Vale. Names may include Ada, Rook.'),
    'Brittany was just really rude.',
  );
  assert.equal(
    trimHallucinatedTail('Twilight is a lot calmer. Thank you for watching! Thanks for watching!'),
    'Twilight is a lot calmer.',
  );
  assert.equal(trimHallucinatedTail('the hours are just better and'), 'the hours are just better and');
});

test('a tail trim never empties a transcript, so the whole-utterance guards still see it', () => {
  assert.equal(trimHallucinatedTail('Thank you for watching!'), 'Thank you for watching!');
  assert.equal(trimHallucinatedTail('Names may include Ada, Rook.'), 'Names may include Ada, Rook.');
  assert.equal(trimHallucinatedTail('I was watching it, thank you.'), 'I was watching it, thank you.');
});
