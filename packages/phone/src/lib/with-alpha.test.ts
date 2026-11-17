// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withAlpha } from './utils.ts';

test('a theme color given as a CSS variable still comes back see-through', () => {
  assert.equal(withAlpha('var(--custom-accent)', 0.05), 'color-mix(in srgb, var(--custom-accent) 5%, transparent)');
  assert.equal(withAlpha('hsl(210 40% 60%)', 0.3), 'color-mix(in srgb, hsl(210 40% 60%) 30%, transparent)');
});

test('hex and rgb keep their rgba form', () => {
  assert.equal(withAlpha('#336699', 0.5), 'rgba(51, 102, 153, 0.5)');
  assert.equal(withAlpha('rgb(1, 2, 3)', 0.2), 'rgba(1, 2, 3, 0.2)');
});
