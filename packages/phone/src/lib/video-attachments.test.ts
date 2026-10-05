// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVideoUrls, safeVideoSrc } from './video-attachments.js';

test('a film at the end of a message comes out and leaves the words alone', () => {
  const r = extractVideoUrls('Done, love.\n [VIDEO]:/api/files/abc');
  assert.deepEqual(r.urls, ['/api/files/abc']);
  assert.equal(r.text, 'Done, love.');
});

test('two films both come out, in order', () => {
  const r = extractVideoUrls('Both. [VIDEO]:/api/files/cedar [VIDEO]:/api/files/willow');
  assert.deepEqual(r.urls, ['/api/files/cedar', '/api/files/willow']);
  assert.equal(r.text, 'Both.');
});

test('a message with no film comes back exactly as it was', () => {
  const s = 'zzzzzzzz   \n  spaced on purpose';
  assert.equal(extractVideoUrls(s).text, s);
  assert.deepEqual(extractVideoUrls(s).urls, []);
});

// Pictures are parsed after films, so a film must never swallow one.
test('a film and a picture in one message go their separate ways', () => {
  const r = extractVideoUrls('look [VIDEO]:/api/files/v [IMG]:/api/files/p');
  assert.deepEqual(r.urls, ['/api/files/v']);
  assert.match(r.text, /^look\s+\[IMG\]:\/api\/files\/p$/);
});

test('a house path and a web address play, and nothing else does', () => {
  assert.equal(safeVideoSrc('/api/files/abc'), '/api/files/abc');
  assert.equal(safeVideoSrc('https://aerie.example.org/api/files/abc'), 'https://aerie.example.org/api/files/abc');
  assert.equal(safeVideoSrc('//elsewhere.example/film.mp4'), null);
  assert.equal(safeVideoSrc('javascript:alert(1)'), null);
});
