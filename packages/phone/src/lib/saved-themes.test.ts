// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveThemeAs, updateSavedTheme, deleteSavedTheme, wearSavedTheme, nextThemeName } from './saved-themes.ts';

const colors = { light: { accent: '#111111' }, dark: { accent: '#eeeeee' } };

test('saving keeps a named copy of both modes and wears it', () => {
  const out = saveThemeAs({ customColors: colors }, 'Ember', 's1')!;
  assert.equal(out.savedThemeId, 's1');
  assert.deepEqual(out.savedThemes, [{ id: 's1', name: 'Ember', colors }]);
  colors.light.accent = '#222222';
  assert.equal(out.savedThemes![0].colors.light.accent, '#111111', 'a copy, not the live slot');
  colors.light.accent = '#111111';
});

test('a theme saved with no name gets the next free My theme', () => {
  assert.equal(nextThemeName([]), 'My theme');
  assert.equal(nextThemeName([{ id: 'a', name: 'My theme', colors }]), 'My theme 2');
  assert.equal(saveThemeAs({ customColors: colors, savedThemes: [{ id: 'a', name: 'My theme', colors }] }, '  ', 'b')!.savedThemes![1].name, 'My theme 2');
});

test('update writes the slot over the one in use; delete lets go of it', () => {
  const saved = [{ id: 's1', name: 'Ember', colors }, { id: 's2', name: 'Fog', colors }];
  const live = { light: { accent: '#ff0000' }, dark: { accent: '#00ff00' } };
  const up = updateSavedTheme({ customColors: live, savedThemes: saved, savedThemeId: 's2' }, 'Fog at dawn')!;
  assert.equal(up.savedThemes![1].name, 'Fog at dawn');
  assert.equal(up.savedThemes![1].colors.light.accent, '#ff0000');
  assert.equal(up.savedThemes![0].colors.light.accent, '#111111');
  const del = deleteSavedTheme({ savedThemes: saved, savedThemeId: 's1' }, 's1');
  assert.deepEqual(del.savedThemes!.map((t) => t.id), ['s2']);
  assert.ok('savedThemeId' in del && del.savedThemeId === undefined);
});

test('wearing a saved theme loads a copy into the working slot', () => {
  const worn = wearSavedTheme({ id: 's1', name: 'Ember', colors });
  assert.equal(worn.id, 'custom');
  assert.equal(worn.savedThemeId, 's1');
  assert.notEqual(worn.customColors, colors);
  assert.deepEqual(worn.customColors, colors);
});
