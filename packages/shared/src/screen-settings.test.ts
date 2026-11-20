// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { keepOtherScreen } from './screen-settings.js';

const stored = {
  theme: {
    mode: 'dark',
    homeWidgets: ['clock', 'note'],
    homeWidgetPlaces: { clock: { col: 0, row: 0 } },
    deskScreen: { homeWidgets: ['weather', 'music'] },
    homeWidgetPlacesDesk: { weather: { col: 3, row: 1 } },
  },
};

test('a phone that opened before the laptop changed keeps its hands off the laptop', () => {
  // The phone's copy of deskScreen is the one it read when it opened.
  const pushed = { theme: { mode: 'light', homeWidgets: ['clock', 'note', 'letter'], deskScreen: { homeWidgets: ['clock'] } }, contacts: {} };
  const out = keepOtherScreen(stored, pushed, 'phone');
  assert.deepEqual(out.theme.homeWidgets, ['clock', 'note', 'letter']);
  assert.equal(out.theme.mode, 'light');
  assert.deepEqual((out.theme as Record<string, unknown>).deskScreen, { homeWidgets: ['weather', 'music'] });
  assert.deepEqual((out.theme as Record<string, unknown>).homeWidgetPlacesDesk, { weather: { col: 3, row: 1 } });
});

test('a laptop push keeps the phone screen as the house has it', () => {
  const pushed = { theme: { mode: 'dark', homeWidgets: ['day'], homeWidgetPlaces: {}, deskScreen: { homeWidgets: ['companions'] } } };
  const out = keepOtherScreen(stored, pushed, 'desk');
  assert.deepEqual(out.theme.homeWidgets, ['clock', 'note']);
  assert.deepEqual(out.theme.homeWidgetPlaces, { clock: { col: 0, row: 0 } });
  assert.deepEqual(out.theme.deskScreen, { homeWidgets: ['companions'] });
});

test('absent stays absent, and an unsaid screen is taken whole', () => {
  const pushed = { theme: { deskScreen: { homeWidgets: ['clock'] } } };
  assert.equal('deskScreen' in keepOtherScreen({ theme: {} }, pushed, 'phone').theme, false);
  assert.deepEqual(keepOtherScreen(stored, pushed, null), pushed);
  assert.deepEqual(keepOtherScreen(null, pushed, 'phone'), pushed);
});
