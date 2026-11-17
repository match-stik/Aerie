// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { customPalette, opaque } from './custom-palette.ts';

const starter = {
  light: { pageBg: '#F4F4F5', panelBg: '#FFFFFF', panelBorder: '#E4E4E7', textMain: '#18181B', textMuted: '#71717A', userBubbleBg: '#A1A1AA99', userBubbleText: '#000000', compBubbleBg: '#E4E4E799', compBubbleText: '#000000', accent: '#18181B', accentText: '#18181B' },
  dark: { pageBg: '#09090B', panelBg: '#18181B', panelBorder: '#27272A', textMain: '#FAFAFA', textMuted: '#A1A1AA', userBubbleBg: '#52525B99', userBubbleText: '#FFFFFF', compBubbleBg: '#27272A99', compBubbleText: '#FFFFFF', accent: '#FAFAFA', accentText: '#FAFAFA' },
};
const SOLID = /^#[0-9a-f]{6}$/i;

test('a see-through pick is laid over the page and comes back solid', () => {
  assert.equal(opaque('#52525B99', '#09090B', '#000000').length, 7);
  assert.equal(opaque('#123', '#000000', '#000000'), '#112233');
  assert.equal(opaque('not a color', '#000000', '#abcdef'), '#abcdef');
});

test('the starter colors make a full palette with every bubble solid, both modes', () => {
  const p = customPalette(starter);
  for (const side of [p.night, p.day]) {
    for (const c of [...side.bubbleUser, ...(side.bubbleComp ?? [])]) assert.match(c, SOLID, c);
    for (const c of [side.primary, side.secondary, side.surface, side.text, side.muted]) assert.match(c, SOLID, c);
  }
  assert.equal(p.night.deep, '#09090B');
  assert.equal(p.day.soft.page, '#F4F4F5');
  assert.equal(p.night.primary, '#FAFAFA', 'the accent is the palette primary');
});

test('no custom colors at all still gives a whole palette', () => {
  const p = customPalette(undefined);
  assert.match(p.night.surface, SOLID);
  assert.match(p.day.bubbleUser[0], SOLID);
});
