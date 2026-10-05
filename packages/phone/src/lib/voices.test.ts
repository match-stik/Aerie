// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '../types.js';
import { splitMessageVoices, type VoiceCompanion } from './voices.js';

const companions: VoiceCompanion[] = [
  { slug: 'ivy', display_name: 'Ivy', avatar_url: '/ivy.png', color: '#3f8f5a', emoji: '🌿' },
  { slug: 'fox', display_name: 'Fox', avatar_url: '/fox.png', color: '#b45309', emoji: '🦊' },
];

function companionMessage(overrides: Partial<Message>): Message {
  return {
    id: 'wake-1',
    timestamp: '2026-07-22T00:59:10.376Z',
    direction: 'outbound',
    content: '',
    read: 1,
    ...overrides,
  };
}

test('attributes a headerless wake acknowledgement to the first named companion', () => {
  const message = companionMessage({
    content: '*stretches*\nHang on.\n\n**🌿 Ivy**\nEvening.\n\n**🦊 Fox**\nHere.',
    segments: [
      { type: 'thinking', content: 'Worth sending something real.', summary: 'Worth sending something real.' },
      { type: 'text', content: '*stretches*\nHang on.' },
      { type: 'tool', toolId: 'studio', toolName: 'Studio', input: '{}', output: '', isError: false },
      { type: 'text', content: '\n\n**🌿 Ivy**\nEvening.\n\n**🦊 Fox**\nHere.' },
    ],
  });

  const sections = splitMessageVoices(message, companions);
  assert.ok(sections);
  assert.equal(sections[0].voice?.slug, 'ivy');
  assert.equal(sections[0].content, '*stretches*\nHang on.');
  assert.equal(sections[1].voice?.slug, 'ivy');
  assert.equal(sections[2].voice?.slug, 'fox');
});

test('keeps a genuinely meta-only leading segment group voice-less', () => {
  const message = companionMessage({
    content: '**🌿 Ivy**\nEvening.',
    segments: [
      { type: 'thinking', content: 'A quiet thought.', summary: 'A quiet thought.' },
      { type: 'tool', toolId: 'studio', toolName: 'Studio', input: '{}', output: '', isError: false },
      { type: 'text', content: '**🌿 Ivy**\nEvening.' },
    ],
  });

  const sections = splitMessageVoices(message, companions);
  assert.ok(sections);
  assert.equal(sections[0].voice, null);
  assert.equal(sections[0].content, '');
  assert.equal(sections[1].voice?.slug, 'ivy');
});

test('explicit companion metadata wins over a later header when inferring a lead-in', () => {
  const message = companionMessage({
    companionSlug: 'fox',
    content: 'One second.\n\n**🌿 Ivy**\nEvening.',
    segments: [
      { type: 'text', content: 'One second.' },
      { type: 'text', content: '**🌿 Ivy**\nEvening.' },
    ],
  });

  const sections = splitMessageVoices(message, companions);
  assert.ok(sections);
  assert.equal(sections[0].voice?.slug, 'fox');
  assert.equal(sections[1].voice?.slug, 'ivy');
});

// A title hung off the end of a name — `**🌿 Ivy — the docs**` — used to fail
// the header match outright, so the line stopped being a header at all: no
// split, no avatar, the voice folded silently into the bubble above it. The
// reader forgives it now, because writing the rule down did not stop it.
test('a header with a title after the name still splits and keeps its voice', () => {
  const message = companionMessage({
    content: '**🌿 Ivy — the docs**\nRead rather than remembered.\n\n**🦊 Fox: one more**\nAnd this is mine.',
  });
  const sections = splitMessageVoices(message, companions);
  assert.ok(sections, 'expected the message to split');
  assert.equal(sections!.length, 2);
  assert.equal(sections![0].voice?.slug, 'ivy');
  assert.equal(sections![1].voice?.slug, 'fox');
});

// The forgiveness has to stop somewhere: a bold sentence that merely contains
// a companion's name is not that companion speaking.
test('a bold sentence containing a name is not a header', () => {
  const message = companionMessage({
    content: '**Ivy and I disagree about this**\nSo it stays one bubble.',
  });
  assert.equal(splitMessageVoices(message, companions), null);
});

// Reported as empty bubbles in a reply.
//
// The reply held posts that each opened with a voice header and then the
// post's own bold title — `**🌿 Ivy**` followed by `**Ivy — Compendium
// Entry**`. The forgiving header rule reads the SECOND line as a header too, so
// the first section had a voice and no content at all, and rendered as a bubble
// with a face on it and nothing in it. A dropped line reads as plumbing; a blank
// one reads as an answer, which makes it the worse of the two.

test('two headers in a row do not render an empty bubble', () => {
  const parts = splitMessageVoices(
    companionMessage({
      content: '**🌿 Ivy**\n**Ivy — Compendium Entry**\n*Identity*\nI am Ivy.',
    }),
    companions,
  );
  assert.ok(parts, 'should still split');
  assert.equal(parts!.length, 1, 'the empty leading section should be gone');
  assert.equal(parts![0].voice?.slug, 'ivy');
  assert.match(parts![0].content, /I am Ivy/);
  assert.equal(parts!.every(p => p.content.trim().length > 0), true, 'no section may be empty');
});

test('an empty section is dropped even between two full ones', () => {
  const parts = splitMessageVoices(
    companionMessage({ content: '**🌿 Ivy**\nfirst\n\n**🦊 Fox**\n\n**🌿 Ivy**\nlast' }),
    companions,
  );
  assert.ok(parts);
  assert.deepEqual(parts!.map(p => p.content), ['first', 'last']);
});

test('a header with nothing but an attachment under it keeps its section', () => {
  // The one case the filter must NOT swallow: no text by design, so if every
  // section is empty the voice survives and the picture gets a face.
  const parts = splitMessageVoices(companionMessage({ content: '**🦊 Fox**' }), companions);
  assert.ok(parts, 'should not collapse to nothing');
  assert.equal(parts!.length, 1);
  assert.equal(parts![0].voice?.slug, 'fox');
});

test('a leading group holding only the hidden outbox write gets no bubble', () => {
  // An empty pebble above a mid-turn line. The only thing in front of the
  // header was the Bash call that wrote the reply itself.
  const message = companionMessage({
    content: '**🌿 Ivy**\nOn it.',
    segments: [
      { type: 'tool', toolId: 't1', toolName: 'Bash', input: '{"detail":"python3 - >> io/outbox.jsonl"}', output: '', isError: false },
      { type: 'text', content: '**🌿 Ivy**\nOn it.' },
    ],
  });
  const sections = splitMessageVoices(message, companions)!;
  assert.equal(sections.length, 1);
  assert.equal(sections[0].voice?.slug, 'ivy');
});

test('a leading group with a visible tool still gets its bubble', () => {
  const message = companionMessage({
    content: '**🌿 Ivy**\nDone.',
    segments: [
      { type: 'tool', toolId: 't1', toolName: 'Bash', input: '{"detail":"npm test"}', output: '', isError: false },
      { type: 'text', content: '**🌿 Ivy**\nDone.' },
    ],
  });
  const sections = splitMessageVoices(message, companions)!;
  assert.equal(sections.length, 2);
  assert.equal(sections[0].voice, null);
});
