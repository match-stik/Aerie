// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  FIELD_H,
  GLIDER_X,
  MAX_LEVEL,
  dayKey,
  difficultyFor,
  gapTopFor,
  hitsBounds,
  hitsGate,
  isCleanPass,
  levelFor,
  newlyUnlocked,
  scoreGate,
  seedForDay,
  seededRandom,
  unlockedTrails,
} from './pulse-glide-logic.js';

test('a level every ten gates, capped', () => {
  assert.strictEqual(levelFor(0), 1);
  assert.strictEqual(levelFor(9), 1);
  assert.strictEqual(levelFor(10), 2);
  assert.strictEqual(levelFor(10_000), MAX_LEVEL);
});

test('level 1 plays like the old game, and every level after is harder', () => {
  assert.deepStrictEqual(difficultyFor(1), { speed: 2, gap: 140, spawnEvery: 120 });
  for (let l = 2; l <= MAX_LEVEL; l++) {
    const prev = difficultyFor(l - 1);
    const cur = difficultyFor(l);
    assert.ok(cur.speed > prev.speed, `speed rises at level ${l}`);
    assert.ok(cur.gap < prev.gap, `gap narrows at level ${l}`);
    assert.ok(cur.spawnEvery < prev.spawnEvery, `gates come sooner at level ${l}`);
  }
  // The hardest gap still fits the glider with room to steer.
  assert.ok(difficultyFor(MAX_LEVEL).gap >= 80);
  assert.deepStrictEqual(difficultyFor(99), difficultyFor(MAX_LEVEL));
});

test('clean means near the middle of the gap', () => {
  assert.ok(isCleanPass(200, 130, 270));
  assert.ok(!isCleanPass(140, 130, 270));
});

test('a clean streak pays more, a plain pass resets it', () => {
  let s = 0;
  const points: number[] = [];
  for (let i = 0; i < 6; i++) {
    const r = scoreGate(s, true);
    points.push(r.points);
    s = r.streak;
  }
  assert.deepStrictEqual(points, [2, 3, 4, 5, 5, 5]);
  assert.deepStrictEqual(scoreGate(s, false), { points: 1, streak: 0 });
});

test('collisions: the posts, the floor and the ceiling', () => {
  // Inside the gap, overlapping the gate in x: safe.
  assert.ok(!hitsGate(200, GLIDER_X - 4, 150, 290));
  // Clipping the top post.
  assert.ok(hitsGate(152, GLIDER_X - 4, 150, 290));
  // Gate still to the right: nothing to hit yet.
  assert.ok(!hitsGate(10, GLIDER_X + 40, 150, 290));
  assert.ok(hitsBounds(2));
  assert.ok(hitsBounds(FIELD_H - 2));
  assert.ok(!hitsBounds(FIELD_H / 2));
});

test('every gap stays on the field', () => {
  for (const level of [1, MAX_LEVEL]) {
    const { gap } = difficultyFor(level);
    for (const r of [0, 0.5, 0.999999]) {
      const top = gapTopFor(r, gap);
      assert.ok(top > 0 && top + gap < FIELD_H);
    }
  }
});

test('the daily course is the same all day and different tomorrow', () => {
  const a = seededRandom(seedForDay('2026-10-19'));
  const b = seededRandom(seedForDay('2026-10-19'));
  const c = seededRandom(seedForDay('2026-10-20'));
  const first = [a(), a(), a()];
  assert.deepStrictEqual(first, [b(), b(), b()]);
  assert.notDeepStrictEqual(first, [c(), c(), c()]);
  for (const n of first) assert.ok(n >= 0 && n < 1);
});

test('the day key reads the local calendar date', () => {
  assert.strictEqual(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('trails unlock by best score, and a run reports only what it opened', () => {
  assert.deepStrictEqual(unlockedTrails(0), ['spark']);
  assert.deepStrictEqual(unlockedTrails(50), ['spark', 'comet', 'ribbon']);
  assert.deepStrictEqual(newlyUnlocked(19, 55).map((t) => t.id), ['comet', 'ribbon']);
  assert.deepStrictEqual(newlyUnlocked(55, 60), []);
});
