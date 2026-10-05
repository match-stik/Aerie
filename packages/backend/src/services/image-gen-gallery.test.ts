// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { GalleryItem } from './image-gen.js';

process.env.NODE_ENV = 'test';
// Household membership is read from the install, so pin both halves of it:
// the owner comes from config, the companions from the database.
process.env.USER_NAME = 'Ada';

const { loadConfig } = await import('../config.js');
loadConfig();

const { initDb, getDb } = await import('./db/init.js');
initDb(':memory:');
const now = new Date().toISOString();
const insertCompanion = getDb().prepare(`
  INSERT INTO companions (id, slug, display_name, claude_md_path, mcp_json_path, created_at, updated_at)
  VALUES (?, ?, ?, '', '', ?, ?)
`);
for (const [slug, name] of [['ivy', 'Ivy'], ['fox', 'Fox'], ['nim', 'Nim']]) {
  insertCompanion.run(slug, slug, name, now, now);
}

const imageGen = await import('./image-gen.js');

const {
  canonicalizeGalleryCast,
  normalizeGalleryPersonTag,
  parseGalleryCastInput,
  deriveGalleryCast,
  detectReferenceImageType,
  makeUniqueReferenceName,
  galleryItemMatchesFilter,
  summarizeGalleryCastGroups,
  paginateGalleryItems,
  normalizeGalleryFilename,
  isSafeSubjectSlug,
} = imageGen;

function item(filename: string, createdAt: string, cast?: GalleryItem['cast']): GalleryItem {
  return {
    filename,
    createdAt,
    size: 1,
    mediaType: 'image',
    ...(cast === undefined ? {} : { cast, castSource: 'manual' as const }),
  };
}

test('reference uploads are identified by bytes and receive collision-safe names', () => {
  assert.equal(detectReferenceImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.equal(detectReferenceImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'jpeg');
  assert.equal(detectReferenceImageType(Buffer.from('GIF89a')), 'gif');
  assert.equal(detectReferenceImageType(Buffer.from('RIFF1234WEBP')), 'webp');
  assert.equal(detectReferenceImageType(Buffer.from('<svg><script/></svg>')), null);

  assert.equal(makeUniqueReferenceName('same face.PNG', 'jpeg', 'one'), 'same_face-one.jpg');
  assert.equal(makeUniqueReferenceName('same face.PNG', 'jpeg', 'two'), 'same_face-two.jpg');
  assert.equal(isSafeSubjectSlug('ivy'), true);
  assert.equal(isSafeSubjectSlug('../ivy'), false);
  assert.equal(isSafeSubjectSlug('ivy/../../..'), false);
  assert.equal(normalizeGalleryFilename('portrait.png'), 'portrait.png');
  assert.equal(normalizeGalleryFilename('_index.json'), null);
  assert.equal(normalizeGalleryFilename('../portrait.png'), null);
});

test('people tags normalize human names while preserving household aliases and stable exact casts', () => {
  assert.equal(normalizeGalleryPersonTag('  Robin Vale  '), 'robin-vale');
  assert.equal(normalizeGalleryPersonTag('Mírá'), 'mira');
  assert.equal(normalizeGalleryPersonTag('---'), null);
  assert.deepEqual(
    canonicalizeGalleryCast(['fox', 'Juno', 'Robin Vale', 'juno', 'ada-temp']),
    ['ada', 'fox', 'juno', 'robin-vale'],
  );
  assert.deepEqual(parseGalleryCastInput([' Juno ', 'Pell', 'Vess']), ['juno', 'pell', 'vess']);
  assert.equal(parseGalleryCastInput(['Juno', '   ']), null);
  assert.equal(parseGalleryCastInput(['Juno', 7]), null);
  assert.equal(parseGalleryCastInput(['Juno, Robin']), null);
  assert.deepEqual(parseGalleryCastInput(['a'.repeat(40)]), ['a'.repeat(40)]);
  assert.equal(parseGalleryCastInput(['a'.repeat(41)]), null);
  assert.equal(parseGalleryCastInput(['a'.repeat(81)]), null);
  assert.equal(parseGalleryCastInput(Array.from({ length: 33 }, (_, i) => `person-${i}`)), null);

  const custom = { cast: ['Juno', 'Robin Vale'], castSource: 'manual' as const };
  assert.deepEqual(deriveGalleryCast(custom), { cast: ['juno', 'robin-vale'], castSource: 'manual' });

  const legacy = { references: ['ada-temp'] };
  assert.deepEqual(deriveGalleryCast(legacy), { cast: ['ada'], castSource: 'selected-references' });
  assert.deepEqual(legacy.references, ['ada-temp']);

  assert.deepEqual(deriveGalleryCast({ referenceDrawers: ['portrait-lighting'] }), {
    cast: undefined,
    castSource: undefined,
  });
  assert.deepEqual(deriveGalleryCast({ referenceDrawers: ['ivy', 'portrait-lighting'] }), {
    cast: undefined,
    castSource: undefined,
  });
  assert.deepEqual(deriveGalleryCast({ cast: [], castSource: 'manual' }), {
    cast: [],
    castSource: 'manual',
  });
});

test('gallery filters distinguish exact, includes, unknown, and explicit no-people casts', () => {
  const trio = item('trio.png', '2026-07-21T03:00:00.000Z', ['fox', 'ivy', 'nim']);
  const girls = item('girls.png', '2026-07-21T02:30:00.000Z', ['juno', 'robin']);
  const unknown = item('unknown.png', '2026-07-21T02:00:00.000Z');
  const noPeople = item('empty.png', '2026-07-21T01:00:00.000Z', []);

  assert.equal(galleryItemMatchesFilter(trio, { cast: ['nim', 'ivy', 'fox'], castMode: 'exact' }), true);
  assert.equal(galleryItemMatchesFilter(trio, { cast: ['ivy'], castMode: 'exact' }), false);
  assert.equal(galleryItemMatchesFilter(trio, { cast: ['ivy'], castMode: 'includes' }), true);
  assert.equal(galleryItemMatchesFilter(girls, { cast: ['Robin', 'Juno'], castMode: 'exact' }), true);
  assert.equal(galleryItemMatchesFilter(girls, { cast: ['Juno'], castMode: 'includes' }), true);
  assert.equal(galleryItemMatchesFilter(unknown, { castState: 'unknown' }), true);
  assert.equal(galleryItemMatchesFilter(noPeople, { castState: 'unknown' }), false);
  assert.equal(galleryItemMatchesFilter(noPeople, { castState: 'none' }), true);
});

test('cast group summaries include custom people and keep them out of Unsorted', () => {
  const summary = summarizeGalleryCastGroups([
    item('girls-one.png', '2026-07-21T04:00:00.000Z', ['juno', 'robin']),
    item('girls-two.png', '2026-07-21T03:00:00.000Z', ['robin', 'juno']),
    item('juno.png', '2026-07-21T02:00:00.000Z', ['juno']),
    item('unknown.png', '2026-07-21T01:00:00.000Z'),
    item('empty.png', '2026-07-21T00:00:00.000Z', []),
  ]);

  assert.deepEqual(summary, {
    groups: [
      { key: 'juno,robin', cast: ['juno', 'robin'], count: 2 },
      { key: 'juno', cast: ['juno'], count: 1 },
    ],
    unknownCount: 1,
    noPeopleCount: 1,
    total: 5,
  });
});

test('cursor pagination is stable, capped, and keeps filtered totals', () => {
  const all = [
    item('a.png', '2026-07-21T04:00:00.000Z', ['ada']),
    item('b.png', '2026-07-21T03:00:00.000Z', ['ada']),
    item('c.png', '2026-07-21T02:00:00.000Z', ['ivy']),
    item('d.png', '2026-07-21T01:00:00.000Z', ['ada']),
  ];
  const first = paginateGalleryItems(all, { limit: 2, filter: { cast: ['ada'], castMode: 'exact' } });
  assert.deepEqual(first.items.map((entry) => entry.filename), ['a.png', 'b.png']);
  assert.equal(first.total, 3);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);

  const second = paginateGalleryItems(all, {
    limit: 2,
    cursor: first.nextCursor!,
    filter: { cast: ['ada'], castMode: 'exact' },
  });
  assert.deepEqual(second.items.map((entry) => entry.filename), ['d.png']);
  assert.equal(second.total, 3);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
});
