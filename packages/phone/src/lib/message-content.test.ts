// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isMediaUrl, parseMessageContent } from './message-content';

const parse = (content: string, extra: { via?: unknown; type?: string } = {}, emojis?: { shortcode: string }[]) =>
  parseMessageContent({ content, ...extra }, emojis, (ref) => (ref === 'bran_good' ? '/s/good.webp' : null));

test('plain words stay plain words', () => {
  const m = parse('  hello there  ');
  assert.equal(m.textContent, 'hello there');
  assert.equal(m.isImage || m.isGif || m.isVoice || m.isFile, false);
});

test('every [IMG]: sentinel on a message comes out, and the words before them stay', () => {
  const m = parse('look at these [IMG]:/a.png [IMG]:/b.png[JSON]:{"x":1}');
  assert.equal(m.textContent, 'look at these');
  assert.deepEqual(m.mediaUrls, ['/a.png', '/b.png']);
  assert.equal(m.mediaUrl, '/a.png');
  assert.equal(m.isImage, true);
});

test('a GIF by sentinel, and a GIF by JSON', () => {
  const a = parse('hi [GIF]:https://x.test/a.gif');
  assert.equal(a.isGif, true);
  assert.equal(a.mediaUrl, 'https://x.test/a.gif');
  assert.equal(a.textContent, 'hi');
  const b = parse('{"type":"gif","url":"https://x.test/b.gif"}');
  assert.equal(b.isGif, true);
  assert.equal(b.mediaUrl, 'https://x.test/b.gif');
  assert.equal(b.textContent, '');
});

test('a message that is only a picture url is a picture; any other url stays words', () => {
  const m = parse('https://x.test/photo.JPG');
  assert.equal(m.isImage, true);
  assert.equal(m.mediaUrl, 'https://x.test/photo.JPG');
  assert.equal(m.textContent, '');
  assert.equal(parse('https://x.test/page').isImage, false);
});

test('a voice note splits a short speaker off, and takes the type as well as the sentinel', () => {
  const a = parse('[VOICE]:Birch: /api/files/1');
  assert.equal(a.isVoice, true);
  assert.equal(a.textToSpeak, '/api/files/1');
  const b = parse('/api/files/2', { type: 'voice' });
  assert.equal(b.isVoice, true);
  assert.equal(b.textToSpeak, '/api/files/2');
});

test('a file block gives its name and text and leaves nothing behind', () => {
  const m = parse('[FILE:notes.txt]: line one\nline two');
  assert.equal(m.isFile, true);
  assert.equal(m.fileName, 'notes.txt');
  assert.equal(m.fileContent, 'line one\nline two');
  assert.equal(m.textContent, '');
});

test('whisper lines become the small heading, one marker only', () => {
  assert.equal(parse('hi\n-# soft').textContent, 'hi\n###### soft');
});

test('a known sticker becomes an image and an unknown one stays as typed', () => {
  assert.match(parse('hey ::bran_good:: you').textContent, /!\[sticker:bran_good\]\(\/s\/good\.webp\)/);
  assert.match(parse('hey ::bran_nope:: you').textContent, /::bran_nope::/);
});

test('only emoji is jumbo; emoji with words is not', () => {
  const only = parse(':wave:', {}, [{ shortcode: 'wave' }]);
  assert.equal(only.isEmoteOnly, true);
  assert.equal(only.emoteSizeClass, '!h-12');
  assert.equal(parse('hi :wave:', {}, [{ shortcode: 'wave' }]).isEmoteOnly, false);
});

test('raw Discord mentions come off a bridged message and stay on a phone one', () => {
  assert.equal(parse('<@123> hi <#456>', { via: 'discord' }).textContent, 'hi');
  assert.equal(parse('<@123> hi').textContent, '<@123> hi');
});

test('isMediaUrl trusts picture paths and its short list of hosts, not lookalikes', () => {
  assert.equal(isMediaUrl('https://x.test/a.webp'), true);
  assert.equal(isMediaUrl('https://media.tenor.com/abc'), true);
  assert.equal(isMediaUrl('https://media.tenor.com.evil.test/abc'), false);
  assert.equal(isMediaUrl('not a url'), false);
});
