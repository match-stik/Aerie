// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Read-aloud gave back nothing from ElevenLabs on a long post.
//
// A user had pressed play on a 7,401-character post in ONE voice. The read-aloud
// route had two branches: several voices went through the chunked renderer, and
// a single voice was sent whole in one request. ElevenLabs refuses anything over
// 5,000 characters with a 400 and returns no audio, so they got silence with
// nothing on screen to say why.
//
// The voice-note path had already been moved to chunk everything, one voice or
// five. Read-aloud kept the old branch, because a single voice long enough to
// trip the ceiling is a case nothing in this house had produced until long
// single-voice posts started being written.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  splitSegmentsForRender,
  PROVIDER_MAX_REQUEST_CHARS,
  SPEECH_CHUNK_TARGET_CHARS,
} from './voice-speaker-split.js';

test('no rendered piece can ever exceed the provider ceiling', () => {
  // One voice, one enormous paragraph with real sentence ends in it.
  const long = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} about a cathedral.`).join(' ');
  assert.ok(long.length > PROVIDER_MAX_REQUEST_CHARS, 'fixture must actually be over the limit');

  const pieces = splitSegmentsForRender([{ voice: 'birch', text: long }]);
  assert.ok(pieces.length > 1, 'a message past the ceiling has to be cut up');
  for (const p of pieces) {
    assert.ok(
      p.text.length <= PROVIDER_MAX_REQUEST_CHARS,
      `a piece of ${p.text.length} chars would come back 400 text_too_long`,
    );
  }
  assert.ok(SPEECH_CHUNK_TARGET_CHARS < PROVIDER_MAX_REQUEST_CHARS);
});

test('splitting moves no characters — the post is spoken whole', () => {
  const text = 'One line.\nTwo line.\n\nThree line, longer, with more in it.\nFour.';
  const pieces = splitSegmentsForRender([{ voice: 'birch', text }]);
  assert.equal(
    pieces.map(p => p.text).join(' ').replace(/\s+/g, ' ').trim(),
    text.replace(/\s+/g, ' ').trim(),
  );
});

test('read-aloud sends a single voice through the chunked renderer too', () => {
  const src = readFileSync(new URL('../routes/api.ts', import.meta.url), 'utf8');
  const at = src.lastIndexOf('read-aloud-${id}.mp3');
  assert.ok(at > 0, 'the read-aloud render should still be here');
  const block = src.slice(Math.max(0, at - 2200), at);
  // The old shape branched on voice COUNT and only chunked the multi case.
  assert.equal(
    /if \(new Set\(segments\.map\(\(s\) => s\.voice\)\)\.size > 1\) \{\s*\n\s*voiceUsed = 'multi';/.test(block),
    false,
    'the single-voice branch must not send the whole message in one request',
  );
  assert.match(block, /generateMultiVoiceMp3\(segments\)/);
});

test('the whole-text fallback is refused when it could only 400', () => {
  const src = readFileSync(new URL('../routes/api.ts', import.meta.url), 'utf8');
  assert.match(
    src,
    /joined\.length > PROVIDER_MAX_REQUEST_CHARS\) throw err;/,
    'falling back to one oversized request just hides why the owner heard nothing',
  );
});

test('the STREAMING read-aloud path cuts by length as well as by speaker', () => {
  // splitByCompanion cuts by SPEAKER only. The live path built its job straight
  // off that, so one voice talking at length was one segment and one oversized
  // request. Same fault, second door — found in the same hour as the first.
  const src = readFileSync(new URL('../routes/api.ts', import.meta.url), 'utf8');
  assert.match(src, /const renderable = splitSegmentsForRender\(prepared\)/);
  assert.equal(
    src.includes('segments: prepared.map((segment, index) => createLiveTtsSegment'),
    false,
    'the live job must be built from length-split pieces, not raw speaker segments',
  );
});
