// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DRAWER_LOOK, drawerIconPx, drawerLookOf, drawerTileStyle } from './drawer-look';

test('an unset theme is the drawer as it always looked', () => {
  assert.deepEqual(drawerLookOf({}), DEFAULT_DRAWER_LOOK);
});

test('each choice is read, and anything unknown falls back to today', () => {
  assert.deepEqual(
    drawerLookOf({ drawerIconSize: 'large', drawerIconShape: 'circle', drawerLabels: 'hidden', drawerIconColor: 'accent', drawerTiles: false }),
    { size: 'large', shape: 'circle', labels: 'hidden', iconColor: 'accent', tiles: false },
  );
  assert.deepEqual(drawerLookOf({ drawerIconSize: 'huge', drawerIconShape: 'star', drawerLabels: 'loud', drawerIconColor: 'red', drawerTiles: 'no' }), DEFAULT_DRAWER_LOOK);
});

test('the default tile is the 56px rounded square it always was, in the theme icon color', () => {
  const s = drawerTileStyle(DEFAULT_DRAWER_LOOK);
  assert.equal(s.width, 'min(56px, 100%)');
  assert.equal(s.borderRadius, '1rem');
  assert.equal(s.color, undefined);
  assert.equal(s.background, undefined);
  assert.equal(drawerIconPx(DEFAULT_DRAWER_LOOK), 28);
});

test('no tiles means no fill, edge or shadow, and a large tile never outgrows its cell', () => {
  const s = drawerTileStyle({ ...DEFAULT_DRAWER_LOOK, size: 'large', tiles: false, iconColor: 'accent' });
  assert.equal(s.width, 'min(64px, 100%)');
  assert.equal(s.background, 'transparent');
  assert.equal(s.boxShadow, 'none');
  assert.equal(s.color, 'var(--aerie-accent)');
});
