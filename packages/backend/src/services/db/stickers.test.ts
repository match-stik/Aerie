// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from './init.js';
import { createSticker, createStickerPack, getSticker, updateSticker } from './stickers.js';

// A pack cannot hold two stickers of the same name. That is a UNIQUE index in
// the schema rather than a check in the code, so the only way anybody learns
// about it is by being thrown at — and the rename route is where it lands,
// because fixing a typo usually means renaming onto the spelling that was
// already taken.
//
// These pin the shape the route's 409 depends on. If the constraint is ever
// relaxed, or the write becomes an INSERT OR REPLACE, the handler stops
// throwing, the error path goes dead, and a rename quietly eats a sticker
// instead of refusing.

const AT = '2026-01-01T00:00:00.000Z';

function packWith(names: string[], packId = 'pack-1') {
  initDb(':memory:');
  createStickerPack({ id: packId, name: 'testpack', createdAt: AT });
  return names.map((name, i) =>
    createSticker({
      id: `${packId}-${name}`,
      packId,
      name,
      filename: `${name}.webp`,
      sortOrder: i,
      createdAt: AT,
    }),
  );
}

test('renaming a sticker to a free name works', () => {
  const [first] = packWith(['blishsweater']);
  assert.equal(updateSticker(first.id, { name: 'blushsweater' }), true);
  assert.equal(getSticker(first.id)?.name, 'blushsweater');
});

test('renaming onto a name the same pack already has is refused, not merged', () => {
  const [, second] = packWith(['blushsweater', 'blishsweater']);
  assert.throws(
    () => updateSticker(second.id, { name: 'blushsweater' }),
    /UNIQUE constraint failed/,
    'the pack must refuse the collision rather than absorb it',
  );
  // And the loser keeps its own name — a failed rename must not half-apply.
  assert.equal(getSticker(second.id)?.name, 'blishsweater');
});

test('the same name in a different pack is fine', () => {
  packWith(['thumbsup']);
  createStickerPack({ id: 'pack-2', name: 'otherpack', createdAt: AT });
  const other = createSticker({
    id: 'pack-2-thunbsup',
    packId: 'pack-2',
    name: 'thunbsup',
    filename: 'thunbsup.webp',
    createdAt: AT,
  });
  assert.equal(updateSticker(other.id, { name: 'thumbsup' }), true);
  assert.equal(getSticker(other.id)?.name, 'thumbsup');
});

test('renaming a sticker that does not exist reports false rather than throwing', () => {
  packWith(['hmm']);
  assert.equal(updateSticker('no-such-sticker', { name: 'whatever' }), false);
});

// Replacing the PICTURE, which had no road at all before Aug 13 2026: upload
// refuses a name the pack already holds, and the update path could not carry a
// filename. These pin the half the route now depends on.
test('a replacement filename lands on the row and the name is left alone', () => {
  const [only] = packWith(['bearonesie']);
  assert.equal(updateSticker(only.id, { filename: 'bearonesie-m1x2.webp' }), true);
  const after = getSticker(only.id);
  assert.equal(after?.filename, 'bearonesie-m1x2.webp');
  assert.equal(after?.name, 'bearonesie', 'replacing the image must not disturb the name');
});

test('a rename without a file leaves the existing filename in place', () => {
  const [only] = packWith(['foxonesie']);
  assert.equal(updateSticker(only.id, { name: 'fox_onesie' }), true);
  const after = getSticker(only.id);
  assert.equal(after?.name, 'fox_onesie');
  assert.equal(after?.filename, 'foxonesie.webp', 'an absent filename must fall through, not blank the column');
});

test('a rename that collides leaves the old filename untouched too', () => {
  const [, second] = packWith(['kittenonesie', 'kittenonsie']);
  assert.throws(() => updateSticker(second.id, { name: 'kittenonesie', filename: 'kittenonsie-9zz.webp' }));
  const after = getSticker(second.id);
  assert.equal(after?.name, 'kittenonsie');
  assert.equal(after?.filename, 'kittenonsie.webp', 'a refused update must not half-apply the new file either');
});
