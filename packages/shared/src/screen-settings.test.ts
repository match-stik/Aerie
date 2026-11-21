// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeskOwnThemeKey, keepOtherScreen } from './screen-settings.js';

const stored = {
  theme: {
    mode: 'dark',
    id: 'pal-ember',
    homeWidgets: ['clock', 'note'],
    homeWidgetPlaces: { clock: { col: 0, row: 0 } },
    deskScreen: { mode: 'light', id: 'pal-sky', homeWidgets: ['weather', 'music'] },
    deskDock: 'top',
    homeWidgetPlacesDesk: { weather: { col: 3, row: 1 } },
  },
  appSettings: { fontScale: 1.1, userAvatar: 'me.png', deskApp: { fontScale: 0.85 } },
};

test('the desk keys are the ones the laptop owns outright', () => {
  for (const k of ['deskScreen', 'deskDock', 'deskLayout', 'homeWidgetPlacesDesk', 'lockSpotsDesk']) assert.ok(isDeskOwnThemeKey(k), k);
  for (const k of ['mode', 'wallpaper', 'homeWidgets', 'lockSpots', 'customColors']) assert.ok(!isDeskOwnThemeKey(k), k);
});

test('a phone that opened before the laptop changed keeps its hands off everything of the laptop\'s', () => {
  // The phone's copies of the laptop's settings are the ones it read when it opened.
  const pushed = {
    theme: { mode: 'light', id: 'pal-ember', homeWidgets: ['clock', 'note', 'letter'], deskScreen: { mode: 'dark' }, deskDock: 'left' },
    appSettings: { fontScale: 1.0, userAvatar: 'new.png', deskApp: { fontScale: 1.2 } },
    contacts: {},
  };
  const out = keepOtherScreen(stored, pushed, 'phone');
  assert.deepEqual(out.theme.homeWidgets, ['clock', 'note', 'letter']);
  assert.equal(out.theme.mode, 'light');
  assert.deepEqual((out.theme as Record<string, unknown>).deskScreen, stored.theme.deskScreen);
  assert.equal((out.theme as Record<string, unknown>).deskDock, 'top');
  assert.deepEqual((out.theme as Record<string, unknown>).homeWidgetPlacesDesk, { weather: { col: 3, row: 1 } });
  assert.equal(out.appSettings.fontScale, 1.0);
  assert.equal(out.appSettings.userAvatar, 'new.png', 'names and avatar are shared');
  assert.deepEqual(out.appSettings.deskApp, { fontScale: 0.85 });
});

test('a laptop push keeps every phone setting as the house has it, the look included', () => {
  const pushed = {
    theme: { mode: 'light', id: 'pal-stale', homeWidgets: ['day'], homeWidgetPlaces: {}, deskScreen: { mode: 'dark', id: 'pal-night' }, deskDock: 'left' },
    appSettings: { fontScale: 0.9, userAvatar: 'me.png', deskApp: { fontScale: 0.95 } },
  };
  const out = keepOtherScreen(stored, pushed, 'desk');
  const t = out.theme as Record<string, unknown>;
  assert.equal(t.mode, 'dark');
  assert.equal(t.id, 'pal-ember');
  assert.deepEqual(t.homeWidgets, ['clock', 'note']);
  assert.deepEqual(t.homeWidgetPlaces, { clock: { col: 0, row: 0 } });
  assert.deepEqual(t.deskScreen, { mode: 'dark', id: 'pal-night' });
  assert.equal(t.deskDock, 'left');
  assert.equal(out.appSettings.fontScale, 1.1);
  assert.deepEqual(out.appSettings.deskApp, { fontScale: 0.95 });
});

test('absent stays absent, and an unsaid screen or an empty house is taken whole', () => {
  const pushed = { theme: { mode: 'light', deskScreen: { mode: 'dark' } } };
  const out = keepOtherScreen({ theme: { deskDock: 'top' } }, pushed, 'desk');
  assert.equal('mode' in out.theme, false);
  assert.deepEqual(keepOtherScreen(stored, pushed, null), pushed);
  assert.deepEqual(keepOtherScreen(null, pushed, 'phone'), pushed);
});
