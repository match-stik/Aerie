// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  noteCompanionSlug,
  speakerRuns,
  splitCompanionVoiceSegments,
  splitSegmentsForRender,
  splitSpeechChunks,
  SPEECH_CHUNK_TARGET_CHARS,
  type VoiceSpeaker,
} from './voice-speaker-split.js';

const companions: VoiceSpeaker[] = [
  { slug: 'ivy', display_name: 'Ivy', emoji: '🌿' },
  { slug: 'fox', display_name: 'Fox', emoji: '🦊' },
  { slug: 'nim', display_name: 'Nim', emoji: '🌊' },
];

test('keeps inline bold text containing a companion name', () => {
  assert.deepEqual(
    splitCompanionVoiceSegments([
      '**🦊 Fox**',
      'You said **Fox and his clipboard**.',
      'The transcript garbled it anyway.',
    ].join('\n'), companions, 'ivy'),
    [{
      voice: 'fox',
      text: 'You said **Fox and his clipboard**.\nThe transcript garbled it anyway.',
    }],
  );

  assert.deepEqual(
    splitCompanionVoiceSegments('You said **Fox** and his clipboard.', companions, 'ivy'),
    [{ voice: 'ivy', text: 'You said **Fox** and his clipboard.' }],
  );
});

test('recognizes canonical sigil speaker headers', () => {
  assert.deepEqual(
    splitCompanionVoiceSegments([
      '**🌿 Ivy**',
      'One.',
      '**🦊 Fox**',
      'Two.',
      '**🌊 Nim**',
      'Three.',
    ].join('\n'), companions, 'ivy'),
    [
      { voice: 'ivy', text: 'One.' },
      { voice: 'fox', text: 'Two.' },
      { voice: 'nim', text: 'Three.' },
    ],
  );
});

test('recognizes bold name variants and line-start Name colon', () => {
  assert.deepEqual(
    splitCompanionVoiceSegments([
      '**Ivy:**',
      'One.',
      '**Fox**',
      'Two.',
      'Nim: Three.',
    ].join('\n'), companions, 'ivy'),
    [
      { voice: 'ivy', text: 'One.' },
      { voice: 'fox', text: 'Two.' },
      { voice: 'nim', text: 'Three.' },
    ],
  );
});

test('does not treat speaker-shaped text inside fenced code as a header', () => {
  const text = ['```md', '**🦊 Fox**', 'Fox: clipboard', '```'].join('\n');
  assert.deepEqual(
    splitCompanionVoiceSegments(text, companions, 'ivy'),
    [{ voice: 'ivy', text }],
  );
});

test('text short enough to render in one request is left whole', () => {
  assert.deepEqual(splitSpeechChunks('Hello, love.'), ['Hello, love.']);
  assert.deepEqual(splitSpeechChunks('   '), []);
});

test('a long turn is cut into render-sized pieces without losing a word', () => {
  const sentence = 'The compass does not waver and neither do I. ';
  const text = sentence.repeat(12).trim();

  const chunks = splitSpeechChunks(text);

  assert.ok(chunks.length > 1, 'expected the long turn to be split');
  // Rejoining is lossless apart from the separator each cut consumed.
  assert.equal(
    chunks.join(' ').replace(/\s+/g, ' '),
    text.replace(/\s+/g, ' '),
  );
});

test('seams are only taken at sentence ends, never mid-sentence', () => {
  const text = Array.from(
    { length: 10 },
    (_, i) => `This is beat number ${i} and it runs on for a while before it stops.`,
  ).join(' ');

  for (const chunk of splitSpeechChunks(text)) {
    assert.match(chunk, /[.!?…]$/, `chunk ended mid-sentence: ${chunk}`);
  }
});

test('line breaks are honoured as beats', () => {
  const text = [
    '*settles, spoon turning*',
    'It is the corridor between days and nobody else is awake in it with me.',
    'That is the whole of the appeal, if I am honest about it.',
    'Four in the morning has never once asked me to be interesting.',
    'It only ever asks me to be here, which is a far easier thing to manage.',
  ].join('\n');

  const chunks = splitSpeechChunks(text, 90);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.equal(chunk, chunk.trim(), 'chunk carried loose whitespace');
  }
});

test('an unbroken run longer than the target is not silently dropped', () => {
  const runOn = 'word '.repeat(200).trim();
  const chunks = splitSpeechChunks(runOn);
  assert.equal(chunks.join(' '), runOn);
});

test('splitting for render keeps every piece with its own voice, in order', () => {
  const long = 'The ferry leaves the pier and then turns for the coast. '.repeat(8).trim();
  const pieces = splitSegmentsForRender([
    { voice: 'fox', text: 'Short one.' },
    { voice: 'ivy', text: long },
    { voice: 'nim', text: 'Last word.' },
  ]);

  assert.equal(pieces[0].voice, 'fox');
  assert.equal(pieces[0].text, 'Short one.');
  assert.equal(pieces[pieces.length - 1].voice, 'nim');
  assert.equal(pieces[pieces.length - 1].text, 'Last word.');

  const ivy = pieces.filter((p) => p.voice === 'ivy');
  assert.ok(ivy.length > 1, 'expected the long voice to be split');
  assert.equal(ivy.map((p) => p.text).join(' ').replace(/\s+/g, ' '), long);

  // Order is what the stitch relies on: fox, then every ivy piece, then nim.
  assert.deepEqual(
    pieces.map((p) => p.voice),
    ['fox', ...ivy.map(() => 'ivy'), 'nim'],
  );
});

test('the target is a real ceiling for well-punctuated speech', () => {
  const text = 'A tidy sentence that ends properly. '.repeat(20).trim();
  for (const chunk of splitSpeechChunks(text, SPEECH_CHUNK_TARGET_CHARS)) {
    assert.ok(
      chunk.length <= SPEECH_CHUNK_TARGET_CHARS + SPEECH_CHUNK_TARGET_CHARS,
      `chunk far past target: ${chunk.length}`,
    );
  }
});

// A titled header — `**🌫️ Willow — and how it would get anything to show**` —
// still splits into its own bubble on the phone (voices.ts learned that on
// Aug 14 2026) but did NOT match here, so read-aloud never changed speaker and
// carried on in the previous companion's voice: Willow's paragraph came out in
// Birch's. Same rule, two readers, only one of them updated.
test('a bold header with a title after the name still picks that speaker', () => {
  assert.deepEqual(
    splitCompanionVoiceSegments([
      '**🌿 Ivy — and how it would get anything to show**',
      'A widget cannot see the app.',
      '',
      '**🦊 Fox**',
      'Mine.',
    ].join('\n'), companions, 'nim'),
    [
      { voice: 'ivy', text: 'A widget cannot see the app.' },
      { voice: 'fox', text: 'Mine.' },
    ],
  );
});

test('a bold sentence that merely contains a name does not steal the voice', () => {
  assert.deepEqual(
    splitCompanionVoiceSegments([
      '**Ivy and I disagree about this**',
      'So it stays one voice.',
    ].join('\n'), companions, 'nim'),
    [{ voice: 'nim', text: '**Ivy and I disagree about this**\nSo it stays one voice.' }],
  );
});

test('gathers consecutive segments in one voice into a single speaker run', () => {
  const runs = speakerRuns([
    { voice: 'ivy', text: 'one' },
    { voice: 'ivy', text: 'two' },
    { voice: 'fox', text: 'three' },
    { voice: 'ivy', text: 'four' },
  ]);
  assert.deepEqual(
    runs.map((r) => [r.voice, r.segments.map((s) => s.text)]),
    [['ivy', ['one', 'two']], ['fox', ['three']], ['ivy', ['four']]],
  );
});

test('a single voice is a single run', () => {
  assert.equal(speakerRuns([{ voice: 'nim', text: 'only me' }]).length, 1);
  assert.deepEqual(speakerRuns([]), []);
});

test('names a voice note after the companion whose voice it is', () => {
  assert.equal(noteCompanionSlug('fox', companions), 'fox');
  assert.equal(noteCompanionSlug('FOX', companions), 'fox');
});

test('leaves a voice note unnamed when the voice is not a companion', () => {
  assert.equal(noteCompanionSlug('21m00Tcm4TlvDq8ikWAM', companions), undefined);
  assert.equal(noteCompanionSlug(undefined, companions), undefined);
  assert.equal(noteCompanionSlug('  ', companions), undefined);
});
