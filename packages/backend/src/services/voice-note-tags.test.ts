// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  leadingTags,
  parseVoiceTags,
  tagRenderPieces,
  voiceNoteTagsFor,
  withLeadingTags,
  VOICE_NOTE_TAGS_PREFIX,
} from './voice-note-tags.js';
import { splitSegmentsForRender, SPEECH_CHUNK_TARGET_CHARS } from './voice-speaker-split.js';

test('parses bracketed tags as written', () => {
  assert.deepEqual(parseVoiceTags('[slowly] [low, deep voice]'), ['[slowly]', '[low, deep voice]']);
});

test('a value with no brackets is one tag rather than words to speak', () => {
  assert.deepEqual(parseVoiceTags('  slowly  '), ['[slowly]']);
});

test('an empty or missing setting is no tags', () => {
  assert.deepEqual(parseVoiceTags(null), []);
  assert.deepEqual(parseVoiceTags(undefined), []);
  assert.deepEqual(parseVoiceTags('   '), []);
});

test('reads the tags the text already opens with', () => {
  assert.deepEqual(leadingTags('  [slowly] [sighs] So. [laughs] later'), ['[slowly]', '[sighs]']);
  assert.deepEqual(leadingTags('So. [laughs]'), []);
});

test('opens the text with the tags', () => {
  assert.equal(
    withLeadingTags('So. Come here.', ['[slowly]', '[low, deep voice]']),
    '[slowly] [low, deep voice] So. Come here.',
  );
});

test('never doubles a tag the text already opens with, whatever its case or spacing', () => {
  const text = '[Slowly]  [low,  deep voice] So.';
  assert.equal(withLeadingTags(text, ['[slowly]', '[low, deep voice]']), text);
});

test('adds only the missing tags and keeps the speaker\'s own', () => {
  assert.equal(
    withLeadingTags('[laughs] So.', ['[slowly]', '[low, deep voice]']),
    '[slowly] [low, deep voice] [laughs] So.',
  );
});

test('leaves empty text empty', () => {
  assert.equal(withLeadingTags('   ', ['[slowly]']), '   ');
});

test('reads the setting for the voice, by slug in lower case', () => {
  const seen: string[] = [];
  const read = (key: string) => {
    seen.push(key);
    return key === `${VOICE_NOTE_TAGS_PREFIX}ivy` ? '[slowly]' : null;
  };
  assert.deepEqual(voiceNoteTagsFor('Ivy', read), ['[slowly]']);
  assert.deepEqual(voiceNoteTagsFor('fox', read), []);
  assert.deepEqual(voiceNoteTagsFor(undefined, read), []);
  assert.deepEqual(seen, [`${VOICE_NOTE_TAGS_PREFIX}ivy`, `${VOICE_NOTE_TAGS_PREFIX}fox`]);
});

test('every render piece of a long note carries the tags, not only the first', () => {
  const sentence = 'This is one plain sentence that runs on for a while. ';
  const long = `[slowly] [low, deep voice] ${sentence.repeat(12)}`.trim();
  const pieces = splitSegmentsForRender([{ voice: 'ivy', text: long }]);
  assert.ok(pieces.length > 1, `expected the note to render in pieces (target ${SPEECH_CHUNK_TARGET_CHARS})`);

  const tagged = tagRenderPieces(pieces, (voice) => (voice === 'ivy' ? ['[slowly]', '[low, deep voice]'] : []));
  for (const piece of tagged) {
    assert.ok(piece.text.startsWith('[slowly] [low, deep voice] '), `untagged piece: ${piece.text.slice(0, 40)}`);
    assert.equal(piece.text.match(/\[slowly\]/g)?.length, 1, 'a tag was doubled');
  }
});

test('a voice with no tags is left exactly as it was', () => {
  const pieces = [{ voice: 'fox', text: 'Hello.' }, { voice: 'ivy', text: 'Hi.' }];
  const tagged = tagRenderPieces(pieces, (voice) => (voice === 'ivy' ? ['[slowly]'] : []));
  assert.equal(tagged[0], pieces[0]);
  assert.equal(tagged[1].text, '[slowly] Hi.');
});
