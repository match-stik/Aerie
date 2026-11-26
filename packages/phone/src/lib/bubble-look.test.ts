// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOOK, bubbleCorners, bubbleLookOf, contrastRatio, nameColor } from './bubble-look.js';

test('the bubbles look as they do today until a switch is flipped', () => {
  assert.deepEqual(bubbleLookOf({}), { faces: true, names: false, edges: false, quietActions: false, actionInk: 'plain', myName: false, tailMine: 'top', tailOurs: 'top', tailShape: 'point', rings: 'house', nameColors: true, dotColors: true });
  assert.deepEqual(
    bubbleLookOf({ bubbleFaces: false, bubbleNames: true, bubbleEdges: true, bubbleQuietActions: true, bubbleMyName: true, bubbleTailMine: 'bottom', bubbleTailOurs: 'sideways', bubbleRings: 'theme', bubbleNameColors: false, bubbleDotColors: false }),
    { faces: false, names: true, edges: true, quietActions: true, actionInk: 'faded', myName: true, tailMine: 'bottom', tailOurs: 'top', tailShape: 'point', rings: 'theme', nameColors: false, dotColors: false },
  );
  assert.equal(bubbleLookOf({ bubbleRings: 'plaid' }).rings, 'house');
});

test('a name color depends on the color and the page, never on who it is', () => {
  assert.equal(nameColor('Willow', '#1e40af', 'dark', '#090807'), nameColor('juniper', '#1e40af', 'dark', '#090807'));
  assert.equal(nameColor('birch', '#ea580c', 'light', '#ffffff'), nameColor('cedar', '#ea580c', 'light', '#ffffff'));
  // No color at all still gets one that reads.
  assert.ok(contrastRatio(nameColor('cedar', null, 'dark', '#000000'), '#000000') >= 4.5);
});

test('anyone else gets their own color, lifted until it reads on the page', () => {
  const night = nameColor('juniper', '#1e40af', 'dark', '#090807');
  assert.ok(contrastRatio(night, '#090807') >= 4.5, night);
  const day = nameColor('juniper', '#f5d0fe', 'light', '#ffffff');
  assert.ok(contrastRatio(day, '#ffffff') >= 4.5, day);
  // A color that already reads is left alone.
  assert.equal(nameColor('juniper', '#ffffff', 'dark', '#000000'), '#ffffff');
});

test('a drawn bubble always names all four corners, so moving its tail cannot leave the old corner pointed', () => {
  const keys = ['borderBottomLeftRadius', 'borderBottomRightRadius', 'borderTopLeftRadius', 'borderTopRightRadius'];
  for (const side of ['mine', 'ours'] as const) {
    for (const tail of ['top', 'bottom'] as const) {
      const c = bubbleCorners(side, tail);
      assert.deepEqual(Object.keys(c).sort(), keys);
      assert.equal(Object.values(c).filter((v) => v === '0').length, 1);
      assert.ok(!('borderRadius' in c));
    }
  }
  assert.equal(bubbleCorners('ours', 'top').borderTopLeftRadius, '0');
  assert.equal(bubbleCorners('ours', 'bottom').borderBottomLeftRadius, '0');
  assert.equal(bubbleCorners('mine', 'top').borderTopRightRadius, '0');
  assert.equal(bubbleCorners('mine', 'bottom').borderBottomRightRadius, '0');
  assert.equal(bubbleCorners('ours', 'bottom').borderTopLeftRadius, 'var(--shape-bubble)');
});

test('the tail shape is the point unless the swoop is picked', () => {
  assert.equal(bubbleLookOf({}).tailShape, 'point');
  assert.equal(bubbleLookOf({ bubbleTailShape: 'swoop' }).tailShape, 'swoop');
  assert.equal(bubbleLookOf({ bubbleTailShape: 'curly' }).tailShape, 'point');
  assert.equal(DEFAULT_LOOK.tailShape, 'point');
});

test('one accent makes three dots at its own lightness, the accent in the middle', async () => {
  const { accentTriad } = await import('./bubble-look');
  const three = accentTriad('#ea580c');
  assert.equal(three.length, 3);
  assert.equal(three[1], '#ea580c');
  assert.notEqual(three[0], three[2]);
  assert.deepEqual(accentTriad('var(--x)'), ['var(--x)', 'var(--x)', 'var(--x)']);
});

test('the action lines keep the old quieter switch as Faded, and a color reads on its bubble', async () => {
  const { actionInkOf, actionColor, contrastRatio } = await import('./bubble-look');
  assert.equal(actionInkOf({}), 'plain');
  assert.equal(actionInkOf({ bubbleQuietActions: true }), 'faded');
  assert.equal(actionInkOf({ bubbleQuietActions: true, bubbleActionInk: 'ours' }), 'ours');
  assert.equal(actionInkOf({ bubbleActionInk: 'plaid' }), 'plain');
  assert.equal(actionColor('plain', { slug: 'birch', color: '#ea580c' }, '#3b82f6', 'dark', ['#111111']), null);
  assert.equal(actionColor('faded', { slug: 'birch', color: '#ea580c' }, '#3b82f6', 'dark', ['#111111']), null);
  for (const ink of ['accent', 'ours'] as const) {
    const c = actionColor(ink, { slug: 'willow', color: '#1e40af' }, '#1e40af', 'dark', ['#111111'])!;
    assert.ok(contrastRatio(c, '#111111') >= 3.5, `${ink} ${c}`);
  }
});
