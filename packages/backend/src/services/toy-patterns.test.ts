// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from './db/init.js';
import { deletePattern, expandPatternAsk, findPattern, listPatterns, renamePattern, savePattern, shapePattern, shelfForLane, firstStretch } from './toy-patterns.js';
import { commandFromLane } from './toy-remote.js';

function fresh() {
  initDb(':memory:');
}

test('a pattern is checked the way a lane play is: levels clamped, short steps raised, one time through at most an hour', () => {
  const ok = shapePattern({ name: '  Low   Ember ', tracks: { motor1: [[25, 50], [6, 4000]] } });
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.name, 'Low Ember');
  assert.deepEqual(ok.tracks.motor1, [[20, 200], [6, 4000]]);
  assert.equal(ok.lengthMs, 4200);

  assert.equal(shapePattern({ name: '', tracks: { motor1: [[5, 1000]] } }).ok, false);
  assert.equal(shapePattern({ name: 'x', tracks: {} }).ok, false);
  const tenMinutes = shapePattern({ name: 'ten minutes', tracks: { motor1: [[5, 300_000], [6, 300_000]] } });
  assert.equal(tenMinutes.ok, true, 'a long pattern of theirs is kept, like Lovense lets them');
  const long = shapePattern({ name: 'too long', tracks: { motor1: [[5, 1_900_000], [6, 1_900_000]] } });
  assert.equal(long.ok, false, 'past an hour is refused');
});

test('a lane playing a long pattern hears its first three minutes a command', () => {
  const stretch = firstStretch({ motor1: [[5, 120_000], [9, 120_000], [3, 60_000]], motor2: [[2, 10_000]] }, 180_000);
  assert.deepEqual(stretch.motor1, [[5, 120_000], [9, 60_000]]);
  assert.deepEqual(stretch.motor2, [[2, 10_000]]);
});

test('the shelf keeps who made each pattern, newest first, and finds one by id or by name', () => {
  fresh();
  const theirs = savePattern({ name: 'Slow tide', companion: null, tracks: { motor1: [[4, 1000]] }, lengthMs: 1000 });
  const his = savePattern({ name: 'Low Ember', companion: 'birch', tracks: { motor1: [[8, 2000]], motor2: [[3, 2000]] }, lengthMs: 2000 });
  assert.ok(!('error' in theirs) && !('error' in his));
  if ('error' in theirs || 'error' in his) return;
  const shelf = listPatterns();
  assert.equal(shelf.length, 2);
  assert.equal(shelf.find((p) => p.id === theirs.id)?.companion, null);
  assert.equal(findPattern('low EMBER')?.id, his.id);
  assert.equal(findPattern(theirs.id)?.name, 'Slow tide');
  assert.equal(findPattern('nothing by that name'), null);

  const lane = shelfForLane();
  assert.deepEqual(lane.patterns.find((p) => p.id === theirs.id)?.by, 'their person');
  assert.deepEqual(lane.patterns.find((p) => p.id === his.id)?.motors, ['motor1', 'motor2']);

  assert.ok(renamePattern(theirs.id, 'Low tide'));
  assert.equal(findPattern(theirs.id)?.name, 'Low tide');
  assert.ok(deletePattern(theirs.id));
  assert.equal(listPatterns().length, 1);
  assert.equal(deletePattern(theirs.id), false);
});

test('a lane playing a pattern by name becomes the tracks ask the remote already plays, loops and all', () => {
  fresh();
  savePattern({ name: 'Low Ember', companion: 'birch', tracks: { motor1: [[8, 2000], [14, 1000]] }, lengthMs: 3000 });
  const expanded = expandPatternAsk({ companion: 'birch', pattern: 'Low Ember', loops: 3 });
  assert.ok(expanded.ok);
  if (!expanded.ok) return;
  const shaped = commandFromLane(expanded.body);
  assert.ok(shaped.ok);
  if (!shaped.ok) return;
  assert.deepEqual(shaped.command.tracks, { motor1: [[8, 2000], [14, 1000]] });
  assert.equal(shaped.command.loops, 3);
  assert.equal(shaped.command.maxMs, 9000);

  assert.equal(expandPatternAsk({ companion: 'birch', pattern: 'not on the shelf' }).ok, false);
  assert.equal(expandPatternAsk({ companion: 'birch', pattern: 'Low Ember', level: 5 }).ok, false);
  // An ask with no pattern in it passes through untouched.
  const plain = { companion: 'willow', level: 4 };
  const passed = expandPatternAsk(plain);
  assert.ok(passed.ok && passed.body === plain);
});
