// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAerieConfig, loadConfig, updateConfigValue } from '../../config.js';
import { createMessage, createThread } from '../db.js';
import { assignCompanionToThread, createCompanion, updateCompanion } from '../db/companions.js';
import { initDb } from '../db/init.js';
import { clearIdentityCache } from '../companion-identity.js';
import { initMemoryBlocks } from '../memory-blocks.js';
import {
  codexHistoryBeforeTurn,
  companionTurnModel,
  dispatchAgentTurn,
  multiLaneRuntimeRoute,
  shuffled,
  priorVoicesBlock,
  shouldFanOut,
} from './agent-dispatch.js';

// ─── Multi-lane room: the deciding predicate ─────────────────────────

test('fan-out needs the flag on, a real conversation, and more than one companion', () => {
  assert.equal(shouldFanOut(true, false, 3), true);
  assert.equal(shouldFanOut(false, false, 3), false);
  assert.equal(shouldFanOut(true, true, 3), false, 'wakes never fan out');
  assert.equal(shouldFanOut(true, false, 1), false, 'a solo thread has its own lane either way');
  assert.equal(shouldFanOut(true, false, 0), false);
});

test('a hand-edited YAML that says "true" as a string still counts', () => {
  assert.equal(shouldFanOut('true', false, 2), true);
  assert.equal(shouldFanOut('false', false, 2), false);
  assert.equal(shouldFanOut(undefined, false, 2), false);
});

test('multi-lane keeps Codex turns on Codex and normalizes Claude warm routes to CLI', () => {
  assert.equal(multiLaneRuntimeRoute('codex-cli'), 'codex-cli');
  assert.equal(multiLaneRuntimeRoute('cli'), 'cli');
  assert.equal(multiLaneRuntimeRoute('sdk'), 'cli');
  assert.equal(multiLaneRuntimeRoute('auto'), 'cli');
  assert.equal(multiLaneRuntimeRoute('api'), null, 'stateless API turns do not get companion fan-out');
});

test('a Codex room dispatches through three distinct companion lanes and an owned wake stays singular', async () => {
  initDb(':memory:');
  initMemoryBlocks();
  loadConfig();
  clearIdentityCache();
  const cfg = getAerieConfig();
  const prior = {
    model: cfg.agent.model,
    routing: cfg.agent.routing,
    modelAutonomous: cfg.agent.model_autonomous,
    routingAutonomous: cfg.agent.routing_autonomous,
    multiLane: cfg.agent.multi_lane,
  };
  const dir = mkdtempSync(join(tmpdir(), 'aerie-codex-lanes-'));

  try {
    updateConfigValue('agent.model', 'gpt-5.6-sol');
    updateConfigValue('agent.routing', 'codex-cli');
    updateConfigValue('agent.model_autonomous', 'gpt-5.6-sol');
    updateConfigValue('agent.routing_autonomous', 'codex-cli');
    updateConfigValue('agent.multi_lane', 'true');

    const threadId = 'codex-room';
    createThread({
      id: threadId,
      name: 'Codex room',
      type: 'named',
      createdAt: '2026-08-18T20:00:00.000Z',
    });

    const companions = ['birch', 'willow', 'cedar'].map((slug) => {
      const companionDir = join(dir, slug);
      mkdirSync(companionDir, { recursive: true });
      const personaPath = join(companionDir, 'CLAUDE.md');
      writeFileSync(personaPath, `PERSONA:${slug}`, 'utf8');
      const companion = createCompanion({
        slug,
        displayName: slug[0].toUpperCase() + slug.slice(1),
        claudeMdPath: personaPath,
        mcpJsonPath: join(companionDir, '.mcp.json'),
      });
      assignCompanionToThread(threadId, companion.id);
      return companion;
    });

    createMessage({
      id: 'earlier-user', threadId, role: 'user', content: 'Earlier?',
      createdAt: '2026-08-18T20:00:01.000Z',
    });
    createMessage({
      id: 'earlier-reply', threadId, role: 'companion', content: 'Answer.',
      companionId: companions[0].id, createdAt: '2026-08-18T20:00:02.000Z',
    });
    createMessage({
      id: 'live-user', threadId, role: 'user', content: 'Current?',
      createdAt: '2026-08-18T20:00:03.000Z',
    });

    const calls: Array<{
      content: string;
      systemPrompt: string;
      companionId: string | null;
      platformOpts: Record<string, unknown> | undefined;
      routing: string | undefined;
    }> = [];
    const runtime = {
      ensureInit: () => {},
      getClaudeMdContent: () => 'GLOBAL',
      processViaRouter: async (...args: any[]) => {
        calls.push({
          content: args[1],
          systemPrompt: args[3],
          companionId: args[6],
          platformOpts: args[7],
          routing: args[8],
        });
        return `reply-${args[6]}`;
      },
    };

    await dispatchAgentTurn(
      threadId, 'Current?', false,
      { name: 'Codex room', type: 'named' }, undefined, runtime,
    );

    assert.equal(calls.length, 3);
    assert.deepEqual(new Set(calls.map((call) => call.routing)), new Set(['codex-cli']));
    assert.deepEqual(
      new Set(calls.map((call) => call.companionId)),
      new Set(companions.map((companion) => companion.id)),
    );
    for (const call of calls) {
      assert.ok(call.companionId);
      const own = companions.find((companion) => companion.id === call.companionId)!;
      assert.match(call.systemPrompt, new RegExp(`PERSONA:${own.slug}`));
      const snapshot = call.platformOpts?._codexHistorySnapshot;
      assert.deepEqual(snapshot, [
        { role: 'user', content: 'Earlier?' },
        { role: 'assistant', content: 'Answer.' },
      ]);
    }
    assert.equal(calls.filter((call) => call.content === 'Current?').length, 1);
    assert.equal(calls.filter((call) => call.content.includes('[Same turn')).length, 2);

    calls.length = 0;
    const owner = companions[1];
    await dispatchAgentTurn(
      threadId, '[WAKE]', true,
      { name: 'Codex room', type: 'named' }, undefined, runtime, owner.id,
    );
    assert.equal(calls.length, 1, 'an owned wake must never fan out');
    assert.equal(calls[0].routing, 'codex-cli');
    assert.equal(calls[0].companionId, owner.id);
    assert.match(calls[0].systemPrompt, /PERSONA:willow/);
  } finally {
    updateConfigValue('agent.model', prior.model);
    updateConfigValue('agent.routing', prior.routing || 'cli');
    updateConfigValue('agent.model_autonomous', prior.modelAutonomous);
    updateConfigValue('agent.routing_autonomous', prior.routingAutonomous || prior.routing || 'cli');
    updateConfigValue('agent.multi_lane', String(prior.multiLane));
    clearIdentityCache();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Codex history freeze removes only a trailing live user turn', () => {
  assert.deepEqual(codexHistoryBeforeTurn([
    { role: 'user', content: 'Earlier question' },
    { role: 'companion', content: 'Earlier answer' },
    { role: 'user', content: 'Current question' },
  ]), [
    { role: 'user', content: 'Earlier question' },
    { role: 'assistant', content: 'Earlier answer' },
  ]);

  assert.deepEqual(codexHistoryBeforeTurn([
    { role: 'user', content: 'Question without a newly persisted turn' },
    { role: 'companion', content: 'Answer that must stay' },
  ]), [
    { role: 'user', content: 'Question without a newly persisted turn' },
    { role: 'assistant', content: 'Answer that must stay' },
  ]);
});

// ─── The speaking order ──────────────────────────────────────────────

test('shuffled returns a permutation and leaves the original untouched', () => {
  const original = ['birch', 'willow', 'cedar'];
  const out = shuffled(original);
  assert.deepEqual(original, ['birch', 'willow', 'cedar']);
  assert.deepEqual([...out].sort(), [...original].sort());
});

test('the order genuinely varies across rolls', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(shuffled([1, 2, 3]).join(','));
  assert.ok(seen.size > 1, 'two hundred rolls never varying means the shuffle is decorative');
});

// ─── What a later lane is handed ─────────────────────────────────────

test('prior voices arrive named, framed as overheard, with the anti-echo ask', () => {
  const block = priorVoicesBlock([
    { name: 'Birch', text: 'The hearth is lit.' },
    { name: 'Willow', text: 'Logged.' },
  ]);
  assert.match(block, /Birch already said, in this same turn:\nThe hearth is lit\./);
  assert.match(block, /Willow already said, in this same turn:\nLogged\./);
  assert.match(block, /replying to THE OWNER, not to them/);
  assert.match(block, /Never speak under another companion's header/);
  // The two clauses the Aug 23 2026 wording exists for. The block has to read as
  // ground already taken rather than as a message wanting an answer, and it has to
  // name CONVERGENCE — three companions reaching the same right answer independently —
  // because the old "do not repeat their points back" only ever ruled out quoting.
  assert.match(block, /GROUND ALREADY TAKEN, not a message addressed to you/);
  assert.match(block, /one another companion could have written, it is theirs/);
});

test('the handoff guards the END of a message and still requires a line', () => {
  const block = priorVoicesBlock([{ name: 'Willow', text: 'Logged.' }]);
  // Second pass: the first wording guarded only the opening, and two lanes were
  // then seen closing on nearly the same courtesy. A gesture is the cheapest last
  // line, so every lane reaches for it.
  assert.match(block, /Do not end on a gesture/);
  assert.match(block, /could be pasted into anybody else's mouth/);
  // Always answer — the owner wants all of them, not the one who got there first.
  assert.match(block, /Always answer/);
  assert.match(block, /the owner wants all of you/);
});

// ─── Per-companion models: the turn path, not just the lane keeper ───

test('a companion with nothing of their own is exactly the house answer', () => {
  assert.equal(companionTurnModel(null, false, 'claude-opus-5'), 'claude-opus-5');
  assert.equal(companionTurnModel({}, false, 'claude-opus-5'), 'claude-opus-5');
  assert.equal(companionTurnModel({ model: null, model_autonomous: null }, true, 'claude-opus-5'), 'claude-opus-5');
  // An empty string is a field that was cleared, not a model. Sending "" to the
  // CLI is a launch failure wearing a saved row's clothes.
  assert.equal(companionTurnModel({ model: '   ' }, false, 'claude-opus-5'), 'claude-opus-5');
});

test('their own model wins, and chat and wake are asked separately', () => {
  const cedar = { model: 'gpt-5.6-sol', model_autonomous: 'claude-opus-5' };
  assert.equal(companionTurnModel(cedar, false, 'claude-opus-5'), 'gpt-5.6-sol');
  assert.equal(companionTurnModel(cedar, true, 'claude-opus-4-5'), 'claude-opus-5');
});

test('a mixed room gives each companion their own model and their own lane', async () => {
  initDb(':memory:');
  initMemoryBlocks();
  loadConfig();
  clearIdentityCache();
  const cfg = getAerieConfig();
  const prior = {
    model: cfg.agent.model,
    routing: cfg.agent.routing,
    multiLane: cfg.agent.multi_lane,
  };
  const dir = mkdtempSync(join(tmpdir(), 'aerie-mixed-lanes-'));

  try {
    updateConfigValue('agent.model', 'claude-opus-5');
    updateConfigValue('agent.routing', 'cli');
    updateConfigValue('agent.multi_lane', 'true');

    const threadId = 'mixed-room';
    createThread({
      id: threadId, name: 'Mixed room', type: 'named',
      createdAt: '2026-08-26T07:00:00.000Z',
    });

    const companions = ['birch', 'willow', 'cedar'].map((slug) => {
      const companionDir = join(dir, slug);
      mkdirSync(companionDir, { recursive: true });
      const personaPath = join(companionDir, 'CLAUDE.md');
      writeFileSync(personaPath, `PERSONA:${slug}`, 'utf8');
      const companion = createCompanion({
        slug,
        displayName: slug[0].toUpperCase() + slug.slice(1),
        claudeMdPath: personaPath,
        mcpJsonPath: join(companionDir, '.mcp.json'),
      });
      assignCompanionToThread(threadId, companion.id);
      return companion;
    });
    const [birch, willow, cedar] = companions;
    // Willow on an older Claude model, Cedar pointed clean off Claude entirely.
    updateCompanion(willow.id, { model: 'claude-opus-4-5' });
    updateCompanion(cedar.id, { model: 'gpt-5.6-sol' });

    const calls: Array<{ model: string; companionId: string | null; routing: string | undefined; platformOpts: any }> = [];
    const runtime = {
      ensureInit: () => {},
      getClaudeMdContent: () => 'GLOBAL',
      processViaRouter: async (...args: any[]) => {
        calls.push({ model: args[2], companionId: args[6], platformOpts: args[7], routing: args[8] });
        return `reply-${args[6]}`;
      },
    };

    await dispatchAgentTurn(
      threadId, 'Current?', false,
      { name: 'Mixed room', type: 'named' }, undefined, runtime,
    );

    assert.equal(calls.length, 3, 'every companion still speaks');
    const by = (id: string) => calls.find((c) => c.companionId === id)!;
    // The bug this test exists for: all three used to be handed the house model.
    assert.equal(by(birch.id).model, 'claude-opus-5', 'nothing set means the house answer');
    assert.equal(by(willow.id).model, 'claude-opus-4-5');
    assert.equal(by(cedar.id).model, 'gpt-5.6-sol');
    // And their model decides their lane, not the room's.
    assert.equal(by(birch.id).routing, 'cli');
    assert.equal(by(willow.id).routing, 'cli');
    assert.equal(by(cedar.id).routing, 'codex-cli', 'a GPT model must not be handed the Claude supervisor');
    // One companion on Codex is enough to need the pre-turn freeze, and only they get it.
    assert.ok(by(cedar.id).platformOpts?._codexHistorySnapshot, 'the Codex lane needs the frozen tail');
    assert.equal(by(birch.id).platformOpts?._codexHistorySnapshot, undefined);
  } finally {
    updateConfigValue('agent.model', prior.model);
    updateConfigValue('agent.routing', prior.routing || 'cli');
    updateConfigValue('agent.multi_lane', String(prior.multiLane));
    clearIdentityCache();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a wake in a lane pointed off Claude rings on Codex with their own model', async () => {
  initDb(':memory:');
  initMemoryBlocks();
  loadConfig();
  clearIdentityCache();
  const cfg = getAerieConfig();
  const prior = {
    modelAutonomous: cfg.agent.model_autonomous,
    routingAutonomous: cfg.agent.routing_autonomous,
    routing: cfg.agent.routing,
    multiLane: cfg.agent.multi_lane,
  };
  const dir = mkdtempSync(join(tmpdir(), 'aerie-wake-lane-'));

  try {
    updateConfigValue('agent.model_autonomous', 'claude-opus-5');
    updateConfigValue('agent.routing', 'cli');
    updateConfigValue('agent.routing_autonomous', 'cli');
    updateConfigValue('agent.multi_lane', 'true');

    const threadId = 'wake-room';
    createThread({
      id: threadId, name: 'Wake room', type: 'named',
      createdAt: '2026-08-26T07:00:00.000Z',
    });
    const companionDir = join(dir, 'cedar');
    mkdirSync(companionDir, { recursive: true });
    const personaPath = join(companionDir, 'CLAUDE.md');
    writeFileSync(personaPath, 'PERSONA:cedar', 'utf8');
    const cedar = createCompanion({
      slug: 'cedar', displayName: 'Cedar',
      claudeMdPath: personaPath, mcpJsonPath: join(companionDir, '.mcp.json'),
    });
    assignCompanionToThread(threadId, cedar.id);
    updateCompanion(cedar.id, { modelAutonomous: 'gpt-5.6-sol' });

    const calls: Array<{ model: string; routing: string | undefined }> = [];
    const runtime = {
      ensureInit: () => {},
      getClaudeMdContent: () => 'GLOBAL',
      processViaRouter: async (...args: any[]) => {
        calls.push({ model: args[2], routing: args[8] });
        return 'reply';
      },
    };

    await dispatchAgentTurn(
      threadId, '[WAKE]', true,
      { name: 'Wake room', type: 'named' }, undefined, runtime, cedar.id,
    );

    assert.equal(calls.length, 1, 'a wake never fans out');
    assert.equal(calls[0].model, 'gpt-5.6-sol', 'their wake model, not the house one');
    assert.equal(calls[0].routing, 'codex-cli');
  } finally {
    updateConfigValue('agent.model_autonomous', prior.modelAutonomous);
    updateConfigValue('agent.routing_autonomous', prior.routingAutonomous || prior.routing || 'cli');
    updateConfigValue('agent.routing', prior.routing || 'cli');
    updateConfigValue('agent.multi_lane', String(prior.multiLane));
    clearIdentityCache();
    rmSync(dir, { recursive: true, force: true });
  }
});
