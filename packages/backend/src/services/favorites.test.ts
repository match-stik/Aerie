// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFavoriteUrl } from './favorites.js';

// A favorite only ever points at a picture already in the house. Anything that
// would make a shelf reach outside it, or climb out of the gallery folder, is
// refused rather than stored.

test('a gallery picture and an uploaded file are kept as their house paths', () => {
  assert.equal(normalizeFavoriteUrl('/api/studio/gallery/img_2026-10-07T01-02-03-004Z_ab12cd.png'), '/api/studio/gallery/img_2026-10-07T01-02-03-004Z_ab12cd.png');
  assert.equal(normalizeFavoriteUrl('/api/files/3f2b1c4d-0000-4000-8000-123456789abc.jpg'), '/api/files/3f2b1c4d-0000-4000-8000-123456789abc.jpg');
});

test('a full link on a house front is trimmed to its path, query and all', () => {
  assert.equal(
    normalizeFavoriteUrl('https://aerie.example/api/studio/gallery/img_a.png?w=256'),
    '/api/studio/gallery/img_a.png',
  );
});

test('a picture outside the house, a climb out of the folder, or junk is refused', () => {
  assert.equal(normalizeFavoriteUrl('https://cdn.example.com/cat.png'), null);
  assert.equal(normalizeFavoriteUrl('/api/studio/gallery/..%2F..%2Faerie.db'), null);
  assert.equal(normalizeFavoriteUrl('/api/studio/gallery/../secret'), null);
  assert.equal(normalizeFavoriteUrl('/etc/passwd'), null);
  assert.equal(normalizeFavoriteUrl(''), null);
  assert.equal(normalizeFavoriteUrl(42), null);
});
