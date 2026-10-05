// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stickerFilenameFor, extForSticker, sanitizeStickerFilename } from './sticker-admin.js';

// A sticker's url is its filename. The picture the user uploads is only as visible
// as its ADDRESS is new — bytes changing under a name that has been used
// before is invisible to every cache between the disk and their screen. These
// pin the address, not the bytes.

test('an upload never lands on the bare name', () => {
  const name = stickerFilenameFor('bearonesie', 'image/webp');
  assert.notEqual(name, 'bearonesie.webp', 'a plain <name><ext> is an address the phone may already hold');
  assert.match(name, /^bearonesie-[a-z0-9]+\.webp$/);
});

test('the same sticker name twice gives two different addresses', () => {
  const first = stickerFilenameFor('bearonesie', 'image/webp', 'aaa');
  const second = stickerFilenameFor('bearonesie', 'image/webp', 'bbb');
  assert.notEqual(first, second, 'delete-and-re-upload must not reuse the address it just freed');
});

test('a replacement and a fresh upload name files the same way', () => {
  // There is one road, so there is one naming rule. The trap was two roads
  // where only one of them versioned.
  assert.equal(
    stickerFilenameFor('foxonesie', 'image/webp', 'zz'),
    stickerFilenameFor('foxonesie', 'image/webp', 'zz'),
  );
});

test('the version token survives sanitization', () => {
  // sanitizeStickerFilename runs again inside writeStickerFile; a hyphen it
  // stripped would silently put the bytes back on the old address.
  const built = stickerFilenameFor('kitten onesie!', 'image/webp', 'm1x2');
  assert.equal(sanitizeStickerFilename(built), built);
  assert.equal(built, 'kitten_onesie_-m1x2.webp');
});

test('extension follows the mimetype, and anything unknown is a png', () => {
  assert.equal(extForSticker('image/webp'), '.webp');
  assert.equal(extForSticker('image/gif'), '.gif');
  assert.equal(extForSticker('image/png'), '.png');
  assert.equal(extForSticker('image/jpeg'), '.png');
});
