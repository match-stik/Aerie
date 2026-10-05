// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileBlockIsHref, houseFileLink, resolveMessageHref, READABLE_EXTS } from './message-links.js';

const PAGE = 'https://aerie.example.org/';

// THE FAULT THIS FILE EXISTS FOR. A relative link is how this house writes a
// file link, and the old renderer parsed hrefs with an absolute-only
// `new URL(href)`. It threw, the href came out '', and an empty href reloads
// the SPA — which is a logout, because session state is React memory. Run
// these against the old implementation and the first two go red.
test('a relative house link resolves instead of collapsing to an empty href', () => {
  assert.equal(
    resolveMessageHref('/api/files/9f2b.txt', PAGE),
    'https://aerie.example.org/api/files/9f2b.txt',
  );
  assert.equal(
    resolveMessageHref('/api/studio/gallery/17.png', PAGE),
    'https://aerie.example.org/api/studio/gallery/17.png',
  );
});

test('an absolute link is left exactly as it was', () => {
  assert.equal(resolveMessageHref('https://example.com/x', PAGE), 'https://example.com/x');
});

test('a scheme we do not serve is not linkable at all', () => {
  assert.equal(resolveMessageHref('javascript:alert(1)', PAGE), '');
  assert.equal(resolveMessageHref('mailto:owner@example.com', PAGE), '');
  assert.equal(resolveMessageHref('', PAGE), '');
  assert.equal(resolveMessageHref(undefined, PAGE), '');
});

test('an inline data image still passes through untouched', () => {
  const src = 'data:image/png;base64,iVBOR';
  assert.equal(resolveMessageHref(src, PAGE), src);
  assert.equal(houseFileLink(src, PAGE, src, ''), null);
});

test('a house file link is recognised and read for its extension', () => {
  const link = houseFileLink(
    'https://aerie.example.org/api/files/9f2b.txt',
    PAGE,
    '/api/files/9f2b.txt',
    '/api/files/9f2b.txt',
  );
  assert.ok(link);
  assert.equal(link.textish, true);
  // The child text was a bare autolinked url, so the chip shows the filename.
  assert.equal(link.label, '9f2b.txt');
});

// How we actually write one: [notes-all-three.txt](/api/files/<uuid>). The url
// has no extension, so reading it alone sent every text file down the save path.
test('a uuid link whose text names a readable file opens in the bubble', () => {
  const link = houseFileLink(
    'https://aerie.example.org/api/files/c27bae02-4278-43c3-943e-cac7e9073db6',
    PAGE,
    '/api/files/c27bae02-4278-43c3-943e-cac7e9073db6',
    'notes-all-three.txt',
  );
  assert.equal(link?.textish, true);
  const pdf = houseFileLink('https://aerie.example.org/api/files/abc', PAGE, null, 'deck.pdf');
  assert.equal(pdf?.textish, false);
});

test('link text the owner wrote wins over the filename', () => {
  const link = houseFileLink(
    'https://aerie.example.org/api/files/9f2b.txt',
    PAGE,
    '/api/files/9f2b.txt',
    'the wake prompt, as it stands',
  );
  assert.equal(link?.label, 'the wake prompt, as it stands');
});

test('what we cannot render takes the save path rather than a guess', () => {
  for (const name of ['deck.pdf', 'kit.zip', 'notes.docx', 'nolonger']) {
    const link = houseFileLink(
      `https://aerie.example.org/api/files/${name}`,
      PAGE,
      null,
      '',
    );
    assert.equal(link?.textish, false, name);
  }
});

test('only /api/ counts — an app route is not a file chip', () => {
  assert.equal(houseFileLink('https://aerie.example.org/?thread=1', PAGE, null, ''), null);
  assert.equal(houseFileLink('https://aerie.example.org/', PAGE, null, ''), null);
});

test('another house is somebody else - external links are left alone', () => {
  assert.equal(houseFileLink('https://example.com/api/files/x.txt', PAGE, null, ''), null);
});

test('the readable list stays lowercase, so an uppercase extension still matches', () => {
  for (const ext of READABLE_EXTS) assert.equal(ext, ext.toLowerCase());
  const link = houseFileLink('https://aerie.example.org/api/files/NOTES.TXT', PAGE, null, '');
  assert.equal(link?.textish, true);
});

// A [FILE:name] block carries the file's TEXT from ChatInput and a bare URL
// from the attachment adapter. The bubble blobbed both, so tapping an attached
// file saved a text file containing "/api/files/<id>".
test('a file block that is only a url is a link, not the file', () => {
  assert.equal(fileBlockIsHref('/api/files/dc5739ce.txt'), true);
  assert.equal(fileBlockIsHref('  /api/files/dc5739ce.txt  '), true);
  assert.equal(fileBlockIsHref('https://aerie.example.org/api/files/x.txt'), true);
});

test('real file text is never mistaken for a link', () => {
  assert.equal(fileBlockIsHref('AERIE STUDIO — STYLE PROMPTS\nPhotorealistic, high detail'), false);
  assert.equal(fileBlockIsHref('one line of notes'), false);
  // A single word with no scheme and no leading slash is content, not a url.
  assert.equal(fileBlockIsHref('Painterly'), false);
  assert.equal(fileBlockIsHref(''), false);
  assert.equal(fileBlockIsHref('   '), false);
});
