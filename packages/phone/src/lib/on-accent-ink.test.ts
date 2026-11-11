// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onAccentInk } from './theme.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// Orange put black on the selected check and pills and crimson put white, in
// the same midnight mode. Selected states read the same whatever the accent:
// light text on anything selected, every theme, both modes; the fill is fitted
// to the ink (fitForWhite) instead.
test('the ink on anything selected is set by the mode, never by the accent', () => {
  assert.equal(onAccentInk('dark'), '#ffffff');
  assert.equal(onAccentInk('light'), '#ffffff');
});

test('a light accent is deepened until white reads on it', async () => {
  const { fitForWhite } = await import('./theme.js');
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const accent of ['#FAFAFA', '#CBA6F7', '#88C0D0', '#E49B5D']) {
    const fill = fitForWhite(accent);
    assert.ok(1.05 / (lum(fill) + 0.05) >= 4.6, `${accent} -> ${fill}`);
  }
  assert.equal(fitForWhite('#1F2937'), '#1f2937');
});

test('every fill in the theme accent reads that one ink', () => {
  assert.match(read('../App.tsx'), /setProperty\('--aerie-on-accent', onAccentInk\(theme\.mode\)\)/);
  const direct: Array<[string, RegExp]> = [
    ['../components/ThreadSwitcher.tsx', /contrastTextColor\((colors\.accent|accentHex)\)/],
    ['../components/LettersApp.tsx', /contrastTextColor\(colors\.accent\)/],
    ['../components/ThresholdsApp.tsx', /contrastTextColor\(colors\.accent\)/],
    ['../components/VoiceModeOverlay.tsx', /contrastTextColor\(colors\.accent\)/],
  ];
  for (const [file, pattern] of direct) assert.doesNotMatch(read(file), pattern, file);
});

test('monochrome at night selects a contact the same way as every other theme', () => {
  assert.doesNotMatch(read('../components/ContactInfo.tsx'), /#52525B/);
});
