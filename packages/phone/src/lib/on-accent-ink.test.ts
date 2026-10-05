// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onAccentInk } from './theme.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// Orange put black on the selected check and pills and crimson put white, in
// the same midnight mode. Selected states should read the same whatever the
// accent.
test('the ink on anything selected is set by the mode, never by the accent', () => {
  assert.equal(onAccentInk('dark'), '#090807');
  assert.equal(onAccentInk('light'), '#ffffff');
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
