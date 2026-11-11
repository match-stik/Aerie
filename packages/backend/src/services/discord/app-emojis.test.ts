// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Our stickers as the bot's own emojis: made once, reused after, remade when
// the sticker's file changes, and never at all when the name would be refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { loadConfig } = await import('../../config.js');
loadConfig();

const { AppEmojiShelf, emojiToken, validEmojiName, emojiImage, APP_EMOJI_PX } = await import('./app-emojis.js');
type Door = import('./app-emojis.js').EmojiDoor;
const { default: sharp } = await import('sharp');

function fakeDoor(opts: { taken?: Record<string, string>; refuse?: boolean } = {}) {
  const made: Array<{ name: string; id: string }> = [];
  const removed: string[] = [];
  let next = 100;
  const taken = { ...(opts.taken ?? {}) };
  const door: Door = {
    async create(_image, name) {
      if (opts.refuse) throw new Error('Missing Access');
      if (taken[name]) throw new Error('Invalid Form Body: name already taken');
      const id = String(next++);
      taken[name] = id;
      made.push({ name, id });
      return { id, animated: false };
    },
    async remove(id) {
      removed.push(id);
      for (const [k, v] of Object.entries(taken)) if (v === id) delete taken[k];
    },
    async find(name) {
      return taken[name] ? { id: taken[name], animated: false } : null;
    },
  };
  return { door, made, removed };
}

const image = async () => ({ data: Buffer.from('png'), animated: false });
const file = (filename = 'side.png', ref = 'cedar_coffeesideeye') => ({ ref, path: '/unused', filename });
const shelfFile = () => join(mkdtempSync(join(tmpdir(), 'app-emojis-')), 'shelf.json');

test('a token is written the way Discord reads an emoji', () => {
  assert.equal(emojiToken('cedar_coffeesideeye', { emojiId: '9', animated: false }), '<:cedar_coffeesideeye:9>');
  assert.equal(emojiToken('willow_wave', { emojiId: '8', animated: true }), '<a:willow_wave:8>');
  assert.ok(validEmojiName('cedar_coffeesideeye'));
  assert.ok(!validEmojiName('a'));
  assert.ok(!validEmojiName('has-dash'));
  assert.ok(!validEmojiName('x'.repeat(33)));
});

test('a sticker becomes an emoji once and is reused after, even from a new shelf object', async () => {
  const path = shelfFile();
  const { door, made } = fakeDoor();
  const shelf = new AppEmojiShelf(() => door, path, image);
  assert.equal(await shelf.tokenFor(file()), '<:cedar_coffeesideeye:100>');
  assert.equal(await shelf.tokenFor(file()), '<:cedar_coffeesideeye:100>');
  const again = new AppEmojiShelf(() => door, path, image);
  assert.equal(await again.tokenFor(file()), '<:cedar_coffeesideeye:100>');
  assert.equal(made.length, 1, 'made once');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).cedar_coffeesideeye.sourceFilename, 'side.png');
});

test('two sends at once make one emoji, not two', async () => {
  const { door, made } = fakeDoor();
  const shelf = new AppEmojiShelf(() => door, shelfFile(), image);
  const [a, b] = await Promise.all([shelf.tokenFor(file()), shelf.tokenFor(file())]);
  assert.equal(a, b);
  assert.equal(made.length, 1);
});

test('a replaced sticker gets a new emoji and the old one is removed', async () => {
  const { door, made, removed } = fakeDoor();
  const shelf = new AppEmojiShelf(() => door, shelfFile(), image);
  await shelf.tokenFor(file('side.png'));
  assert.equal(await shelf.tokenFor(file('side-v2.png')), '<:cedar_coffeesideeye:101>');
  assert.deepEqual(removed, ['100']);
  assert.equal(made.length, 2);
});

test('an emoji the shelf lost track of is replaced, not duplicated', async () => {
  const { door, removed } = fakeDoor({ taken: { cedar_coffeesideeye: '55' } });
  const shelf = new AppEmojiShelf(() => door, shelfFile(), image);
  assert.equal(await shelf.tokenFor(file()), '<:cedar_coffeesideeye:100>');
  assert.deepEqual(removed, ['55']);
});

test('no door, a refused name, or a refusal from Discord all hand back null', async () => {
  assert.equal(await new AppEmojiShelf(() => null, shelfFile(), image).tokenFor(file()), null);
  const { door } = fakeDoor();
  assert.equal(await new AppEmojiShelf(() => door, shelfFile(), image).tokenFor(file('x.png', 'bad-name')), null);
  const refusing = fakeDoor({ refuse: true });
  assert.equal(await new AppEmojiShelf(() => refusing.door, shelfFile(), image).tokenFor(file()), null);
});

test('the emoji picture is a PNG no bigger than Discord asks for', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-emojis-img-'));
  const src = join(dir, 'big.png');
  writeFileSync(src, await sharp({ create: { width: 512, height: 400, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer());
  const out = await emojiImage(src);
  const meta = await sharp(out.data).metadata();
  assert.equal(out.animated, false);
  assert.equal(meta.format, 'png');
  assert.ok((meta.width ?? 0) <= APP_EMOJI_PX && (meta.height ?? 0) <= APP_EMOJI_PX);
});
