// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert';
import { MAX_LIGHTS, castLights, normalHex, waterAt, zoneFor } from './deep-world.js';
import { luminance } from './arcade-kit.js';
import { WORLDS } from './glide-worlds.js';

test('the sea gets deeper as the levels climb: shallows, twilight, midnight', () => {
  assert.deepStrictEqual([1, 2, 3, 5, 6, 8].map(zoneFor), [0, 0, 1, 1, 2, 2]);
});

test('a companion colour is read as #rrggbb, short hex spelled out, anything else left to the palette', () => {
  assert.strictEqual(normalHex('#FF9A57'), '#FF9A57');
  assert.strictEqual(normalHex(' #abc '), '#aabbcc');
  assert.strictEqual(normalHex('rgb(1,2,3)'), null);
  assert.strictEqual(normalHex(null), null);
});

test('the lights are the house\'s own companions, in order, at most three', () => {
  assert.deepStrictEqual(castLights(['#ff6a1a', null, '#b388ff', '#123456']), ['#ff6a1a', null, '#b388ff']);
  assert.strictEqual(castLights(['#111111', '#222222', '#333333', '#444444', '#555555']).length, MAX_LIGHTS);
  assert.deepStrictEqual(castLights([]), []);
});

const tidewaterNight = {
  page: '#001B23', surface: '#002B36', velvet: '#073642', primary: '#2AA198', secondary: '#268BD2',
  glow: '#9DA3E3', spark: '#CB4B16', text: '#EEE8D5', light: false,
};
const tidewaterDay = {
  page: '#DCE5E5', surface: '#EEF2F2', velvet: '#DDEDEE', primary: '#1E7F78', secondary: '#1F6FA8',
  glow: '#3E518A', spark: '#CB4B16', text: '#073642', light: true,
};

test('the water darkens all the way down, by night and by day', () => {
  for (const p of [tidewaterNight, tidewaterDay]) {
    const mid = (d: number) => {
      const w = waterAt(p, d);
      return (luminance(w.top) + luminance(w.bottom)) / 2;
    };
    assert.ok(mid(0) > mid(1), `shallows lighter than twilight (${p.light ? 'day' : 'night'})`);
    assert.ok(mid(1) > mid(2), `twilight lighter than midnight (${p.light ? 'day' : 'night'})`);
    assert.ok(mid(0.5) < mid(0) && mid(0.5) > mid(1), 'between zones it blends');
  }
});

test('Signal Glide offers the rooftops and the deep', () => {
  assert.deepStrictEqual(WORLDS.map((w) => w.id), ['rooftops', 'deep']);
});
