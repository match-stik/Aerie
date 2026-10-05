// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TAPE_PRESETS,
  TAPE_PRESET_IDS,
  createTapeDataURL,
  isTapePreset,
  tapeColorFor,
  tapeMaterial,
  tapePath,
  tapeSvg,
  toBase64,
} from './press-tape.js';

function decode(dataURL: string): string {
  const prefix = 'data:image/svg+xml;base64,';
  assert.ok(dataURL.startsWith(prefix), 'data URL should declare svg + base64');
  return Buffer.from(dataURL.slice(prefix.length), 'base64').toString('utf8');
}

test('the hand-rolled base64 agrees with the runtime that has one', () => {
  // The control. If these ever disagree, every strip already on a page is wrong.
  for (const preset of TAPE_PRESET_IDS) {
    for (const seed of [1, 2, 97, 1234, 2_000_000_000]) {
      const svg = tapeSvg(preset, '#d7b77d', seed);
      const mine = createTapeDataURL(preset, '#d7b77d', seed).split(',')[1];
      const theirs = Buffer.from(svg, 'utf8').toString('base64');
      assert.equal(mine, theirs, `${preset}/${seed} encoded differently`);
    }
  }
});

test('base64 padding is right at every length remainder', () => {
  // Written after the first version of this test stayed green with the padding
  // deliberately broken: it round-tripped through Buffer and never once called
  // the encoder it claimed to be testing. Every group of three bytes is the
  // whole of base64's difficulty, so walk all three remainders against Buffer.
  for (let length = 0; length <= 12; length += 1) {
    const bytes = new Uint8Array(Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff));
    assert.equal(
      toBase64(bytes),
      Buffer.from(bytes).toString('base64'),
      `length ${length} (remainder ${length % 3}) encoded differently`,
    );
  }
});

test('a strip is the same strip every time it is rebuilt', () => {
  const once = createTapeDataURL('masking', '#d7b77d', 4242);
  const again = createTapeDataURL('masking', '#d7b77d', 4242);
  assert.equal(once, again);
  assert.notEqual(once, createTapeDataURL('masking', '#d7b77d', 4243));
});

test('the seed moves the torn edge', () => {
  assert.notEqual(tapePath(1), tapePath(2));
  assert.equal(tapePath(9), tapePath(9));
});

test('every preset renders and declares its own profile', () => {
  const seen = new Set<string>();
  for (const preset of TAPE_PRESET_IDS) {
    const svg = tapeSvg(preset, '#d7b77d', 500);
    assert.match(svg, /<svg[^>]*width="300"[^>]*height="100"/);
    const opacity = svg.match(/fill-opacity="([0-9.]+)"/)?.[1];
    assert.ok(opacity, `${preset} has no base opacity`);
    seen.add(opacity!);
  }
  assert.equal(seen.size, TAPE_PRESET_IDS.length, 'two presets share a profile');
});

test('repair tape will not be tinted and the others will', () => {
  assert.equal(tapeColorFor('repair', '#ff8800'), '#24211f');
  assert.equal(tapeColorFor('masking', '#ff8800'), '#ff8800');
  assert.equal(tapeColorFor('masking', null), '#d7b77d');
});

test('a colour that is not a colour cannot get into the markup', () => {
  const hostile = '"/><script>x</script><path fill="';
  const svg = tapeSvg('masking', hostile, 7);
  assert.ok(!svg.includes('<script>'), 'colour escaped into the document');
  assert.ok(svg.includes('#d7b77d'), 'should fall back to the preset colour');
  assert.equal(tapeColorFor('masking', hostile), '#d7b77d');
});

test('tapeMaterial hands over a recipe that rebuilds its own picture', () => {
  const made = tapeMaterial('vellum', { color: '#f2dfb5', seed: 31337 });
  assert.deepEqual(made.recipe, { kind: 'tape', preset: 'vellum', color: '#f2dfb5', seed: 31337 });
  assert.equal(made.mimeType, 'image/svg+xml');
  assert.equal(
    made.dataURL,
    createTapeDataURL(made.recipe.preset, made.recipe.color, made.recipe.seed),
  );
  assert.match(decode(made.dataURL), /<svg/);
});

test('the preset list and the preset table stay in step', () => {
  assert.deepEqual(TAPE_PRESETS.map((item) => item.id), [...TAPE_PRESET_IDS]);
  for (const preset of TAPE_PRESETS) {
    assert.match(preset.color, /^#[0-9a-f]{6}$/i, `${preset.id} has no usable colour`);
    assert.ok(preset.label.length > 0 && preset.note.length > 0);
  }
  assert.equal(isTapePreset('masking'), true);
  assert.equal(isTapePreset('sellotape'), false);
  assert.equal(isTapePreset(null), false);
});

test('nothing in here reaches for a browser', () => {
  // The whole point of the move. If a browser global creeps back in, this
  // throws here in Node long before it silently no-ops in a lane.
  const globals = globalThis as Record<string, unknown>;
  const hadDocument = 'document' in globals;
  assert.equal(hadDocument, false, 'test env unexpectedly has a document');
  assert.doesNotThrow(() => createTapeDataURL('paper', '#d68b69', 11));
});
