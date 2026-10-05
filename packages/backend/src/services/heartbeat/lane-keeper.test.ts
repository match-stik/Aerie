// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert';
import { companionLaneKeeperModel, ensureCompanionLanes, heartbeatLaneKeeperModel, laneKeeperEffort, LaneNotOnClaude, type LaneKeeperDeps } from './lane-keeper.js';

function fakeDeps(overrides: Partial<LaneKeeperDeps> = {}) {
  const warmed: Array<{ key: string; slug: string }> = [];
  const deps: LaneKeeperDeps = {
    enabled: () => true,
    roster: () => [
      { id: 'birch', slug: 'birch' },
      { id: 'willow', slug: 'willow' },
      { id: 'cedar', slug: 'cedar' },
    ],
    isWarm: () => false,
    warm: (key, slug) => { warmed.push({ key, slug }); },
    ...overrides,
  };
  return { deps, warmed };
}

test('flag off: the keeper touches nothing', () => {
  const { deps, warmed } = fakeDeps({ enabled: () => false });
  assert.deepEqual(ensureCompanionLanes(deps), []);
  assert.equal(warmed.length, 0);
});

test('the keeper warms a Claude lane and never sends a Codex model through the heartbeat supervisor', () => {
  assert.equal(heartbeatLaneKeeperModel(
    true, 'claude-fable-5', 'cli', 'claude-haiku-4-5', 'cli',
  ), 'claude-fable-5');
  assert.equal(heartbeatLaneKeeperModel(
    true, 'gpt-5.6-sol', 'codex-cli', 'claude-fable-5', 'cli',
  ), 'claude-fable-5', 'Claude-owned wakes stay warm while interactive chat rides Codex');
  assert.equal(heartbeatLaneKeeperModel(
    true, 'gpt-5.6-sol', 'codex-cli', 'gpt-5.6-terra', 'codex-cli',
  ), null, 'Codex app-server threads need no heartbeat keeper');
  assert.equal(heartbeatLaneKeeperModel(
    false, 'claude-fable-5', 'cli', 'claude-haiku-4-5', 'cli',
  ), null);
});

test('flag on: every cold companion lane is warmed once', () => {
  const { deps, warmed } = fakeDeps();
  assert.deepEqual(ensureCompanionLanes(deps), ['birch', 'willow', 'cedar']);
  assert.deepEqual(warmed.map((w) => w.key), ['birch', 'willow', 'cedar']);
});

test('an already-warm lane is left alone', () => {
  const { deps, warmed } = fakeDeps({ isWarm: (key) => key === 'willow' });
  assert.deepEqual(ensureCompanionLanes(deps), ['birch', 'cedar']);
  assert.ok(!warmed.some((w) => w.key === 'willow'));
});

test('one lane refusing to light does not stop the others', () => {
  const { deps, warmed } = fakeDeps({
    warm: (key, slug) => {
      if (key === 'birch') throw new Error('no identity');
      warmed.push({ key, slug });
    },
  });
  assert.deepEqual(ensureCompanionLanes(deps), ['willow', 'cedar']);
});

test('the keeper has no kill path: deps expose warming only', () => {
  // Structural guarantee, stated as a test so a future "helpful" stop/kill
  // hook shows up as a red diff here first: the dependency surface the keeper
  // acts through has exactly these four verbs, none of which can end a lane.
  const { deps } = fakeDeps();
  assert.deepEqual(Object.keys(deps).sort(), ['enabled', 'isWarm', 'roster', 'warm']);
});

test("a companion's own model wins over the house setting", () => {
  assert.equal(companionLaneKeeperModel(
    true, { model: 'claude-haiku-4-5' }, 'claude-fable-5', 'cli', 'claude-fable-5', 'cli',
  ), 'claude-haiku-4-5');
});

test('a companion with nothing of their own is exactly the house answer', () => {
  const house = heartbeatLaneKeeperModel(true, 'claude-fable-5', 'cli', 'claude-haiku-4-5', 'cli');
  assert.equal(companionLaneKeeperModel(
    true, { model: null, model_autonomous: null }, 'claude-fable-5', 'cli', 'claude-haiku-4-5', 'cli',
  ), house);
  assert.equal(companionLaneKeeperModel(
    true, {}, 'claude-fable-5', 'cli', 'claude-haiku-4-5', 'cli',
  ), house);
});

test('a companion pointed at Codex is skipped rather than warmed on the house model', () => {
  // Their interactive turns do not run through the Claude supervisor, so a warm
  // Claude lane for them would stand open and never be used.
  assert.equal(companionLaneKeeperModel(
    true, { model: 'gpt-5.6-sol', model_autonomous: 'gpt-5.6-terra' },
    'claude-fable-5', 'codex-cli', 'claude-fable-5', 'codex-cli',
  ), null);
});

test("a companion on Codex interactively still gets their lane warmed for Claude-owned wakes", () => {
  assert.equal(companionLaneKeeperModel(
    true, { model: 'gpt-5.6-sol', model_autonomous: 'claude-fable-5' },
    'claude-haiku-4-5', 'codex-cli', 'claude-haiku-4-5', 'cli',
  ), 'claude-fable-5');
});

test('the keeper asks for the same effort a real turn would', () => {
  // Two callers reach the supervisor's ensure(), and ensure() recycles the
  // session when the effort changes. A keeper with its own opinion therefore
  // restarts the lane every pass and kills whatever turn is mid-sentence —
  // which presents as a companion who has simply gone silent.
  assert.equal(laneKeeperEffort({ agent: { claude_effort: 'medium', effort: 'high' } }), 'medium');
  assert.equal(laneKeeperEffort({ agent: { effort: 'high' } }), 'high');
  assert.equal(laneKeeperEffort({ agent: {} }), 'adaptive');
});

test('a companion deliberately off Claude is walked past in silence, not reported as a fault', () => {
  const logged: unknown[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { logged.push(args); };
  try {
    const { deps, warmed } = fakeDeps({
      warm: (key, slug) => {
        if (key === 'cedar') throw new LaneNotOnClaude(slug);
        warmed.push({ key, slug });
      },
    });
    assert.deepEqual(ensureCompanionLanes(deps), ['birch', 'willow']);
    assert.deepEqual(logged, [], 'a working route is not an error to shout about once a minute');
  } finally {
    console.warn = warn;
  }
});

test('a lane that genuinely cannot light is still reported', () => {
  const logged: unknown[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { logged.push(args); };
  try {
    const { deps } = fakeDeps({
      warm: (key) => { if (key === 'birch') throw new Error('no identity'); },
    });
    ensureCompanionLanes(deps);
    assert.equal(logged.length, 1, 'silence is for the deliberate case only');
  } finally {
    console.warn = warn;
  }
});

test('the flag still governs a per-companion model', () => {
  assert.equal(companionLaneKeeperModel(
    false, { model: 'claude-haiku-4-5' }, 'claude-fable-5', 'cli', 'claude-fable-5', 'cli',
  ), null);
});
