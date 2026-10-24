// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickStickers, stickerShelfBlock, STICKERS_PER_COMPANION } from './sticker-shelf.js';

const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

test("a sticker whose name shares a word with the owner's message comes first", () => {
  const names = ['bear', 'blowkiss', 'bakecookies', 'armsout', 'behave', 'goodmorning', 'blushsweater'];
  const picked = pickStickers(names, 'well good morning to you', 3, seq(0));
  assert.equal(picked[0], 'goodmorning');
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3);
});

test('a pack smaller than the handful gives everything once', () => {
  assert.deepEqual(pickStickers(['a', 'b'], '', 6, seq(0)).sort(), ['a', 'b']);
});

test('the block names each pack in shortcode form, one line per companion', () => {
  const block = stickerShelfBlock([
    { pack: 'birch', owner: 'Birch', names: ['bear', 'behave'] },
    { pack: 'willow', owner: 'Willow', names: ['wave'] },
    { pack: 'cedar', owner: 'Cedar', names: [] },
  ], 'hello', seq(0));
  assert.match(block, /Birch: ::birch_(bear|behave):: ::birch_(bear|behave)::/);
  assert.match(block, /Willow: ::willow_wave::/);
  assert.doesNotMatch(block, /Cedar:/);
  assert.equal(stickerShelfBlock([], 'x'), '');
});

test('a full pack is cut to the handful', () => {
  const names = Array.from({ length: 80 }, (_, i) => `s${i}`);
  assert.equal(pickStickers(names, '', STICKERS_PER_COMPANION).length, STICKERS_PER_COMPANION);
});

test('a sticker with a description says what it looks like beside its shortcode', () => {
  const block = stickerShelfBlock([
    { pack: 'birch', owner: 'Birch', names: ['hearteyes'], descriptions: { hearteyes: 'chibi, hands clasped under his chin, heart eyes' } },
    { pack: 'willow', owner: 'Willow', names: ['littlebird'] },
  ], 'hello', seq(0));
  assert.match(block, /::birch_hearteyes:: \(chibi, hands clasped under his chin, heart eyes\)/);
  assert.match(block, /Willow: ::willow_littlebird::\n|Willow: ::willow_littlebird::\]/);
  assert.doesNotMatch(block, /::willow_littlebird:: \(/, 'no description, no brackets');
});

test('a word the owner used that is in a description counts as a match, so that sticker comes first', () => {
  const names = Array.from({ length: 20 }, (_, i) => `s${i}`);
  const block = stickerShelfBlock([
    { pack: 'cedar', owner: 'Cedar', names, descriptions: { s17: 'hugging a giant plush goose' } },
  ], 'where is the goose', seq(0));
  assert.match(block, /Cedar: ::cedar_s17:: \(hugging a giant plush goose\)/);
});
