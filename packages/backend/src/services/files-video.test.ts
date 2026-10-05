// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// A FILM IS A HOUSE FILE NOW. Films used to have to go out as zips because this
// door had no video in it. These pin it open for mp4 and keep a .webm meaning
// audio, which it already did.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getContentTypeFromMime, isAllowedMime, resolveMimeType } from './files.js';

test('an mp4 is allowed through the door', () => {
  assert.equal(isAllowedMime('video/mp4'), true);
});

test('an mp4 the browser could not name is still read as a film', () => {
  assert.equal(resolveMimeType('willow-in-paper.mp4', 'application/octet-stream'), 'video/mp4');
});

test('a .webm still means audio', () => {
  assert.equal(resolveMimeType('note.webm', 'application/octet-stream'), 'audio/webm');
});

// The phone tells a film apart by its mime, because a film is stored as a
// plain file rather than getting a content type of its own.
test('a film is stored as a plain file', () => {
  assert.equal(getContentTypeFromMime('video/mp4'), 'file');
});
