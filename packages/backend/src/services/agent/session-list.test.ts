// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectKeyForDir, parseSessionHead } from './session-list.js';

test('project key matches Claude Code on-disk encoding', () => {
  assert.equal(projectKeyForDir('/home/ada_q1/aerie'), '-home-ada-q1-aerie');
  assert.equal(
    projectKeyForDir('/home/ada_q1/aerie/data/heartbeat/primary'),
    '-home-ada-q1-aerie-data-heartbeat-primary',
  );
});

test('ai-title becomes the summary and metadata comes from early entries', () => {
  const head = [
    JSON.stringify({ type: 'ai-title', aiTitle: 'Evening couch session', sessionId: 'abc' }),
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-07-04T23:43:38.836Z', sessionId: 'abc' }),
    JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'text', text: 'Hello boys, how is the night going?' }] },
      timestamp: '2026-07-04T23:43:40.000Z',
      gitBranch: 'main',
      cwd: '/home/ada_q1/aerie',
    }),
  ].join('\n');

  const meta = parseSessionHead(head);
  assert.equal(meta.summary, 'Evening couch session');
  assert.equal(meta.firstPrompt, 'Hello boys, how is the night going?');
  assert.equal(meta.gitBranch, 'main');
  assert.equal(meta.cwd, '/home/ada_q1/aerie');
  assert.equal(meta.createdAt, Date.parse('2026-07-04T23:43:38.836Z'));
});

test('meta, sidechain, and tool_result user entries never become the first prompt', () => {
  const head = [
    JSON.stringify({ type: 'user', isMeta: true, message: { content: 'context injection preamble' } }),
    JSON.stringify({ type: 'user', isSidechain: true, message: { content: 'subagent chatter' } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'tool output' }] } }),
    JSON.stringify({ type: 'user', message: { content: 'the real first prompt' } }),
  ].join('\n');

  const meta = parseSessionHead(head);
  assert.equal(meta.firstPrompt, 'the real first prompt');
  assert.equal(meta.summary, 'the real first prompt');
});

test('a truncated trailing line is skipped without losing earlier entries', () => {
  const head =
    JSON.stringify({ type: 'ai-title', aiTitle: 'Truncation survivor' }) +
    '\n{"type":"user","message":{"content":"cut off mid-';

  const meta = parseSessionHead(head);
  assert.equal(meta.summary, 'Truncation survivor');
  assert.equal(meta.firstPrompt, undefined);
});

test('custom title is carried alongside the summary', () => {
  const head = [
    JSON.stringify({ type: 'ai-title', aiTitle: 'Auto title' }),
    JSON.stringify({ type: 'custom-title', customTitle: 'A rename' }),
  ].join('\n');

  const meta = parseSessionHead(head);
  assert.equal(meta.summary, 'Auto title');
  assert.equal(meta.customTitle, 'A rename');
});

// A CONTEXT IS A SNAPSHOT, NOT A SUM. A turn re-sends the whole conversation
// once per assistant message, so a tool-heavy turn's cache-read total runs to
// several times the window — adding the per-turn figures together and calling
// the result a context is what printed "Ctx 723%" on the Status app.
test('context tokens are the end of the conversation, not every prompt added up', async () => {
  const { mkdtempSync, writeFileSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readSessionUsage } = await import('./session-list.js');

  // Three assistant messages in one turn, each re-sending a bigger prompt.
  const lines = [10_000, 20_000, 30_000].map((cacheRead, i) => JSON.stringify({
    type: 'assistant',
    message: {
      model: 'claude-opus-5',
      usage: {
        input_tokens: 5,
        output_tokens: 100 * (i + 1),
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: 50,
      },
    },
  }));
  const file = join(mkdtempSync(join(tmpdir(), 'aerie-usage-')), 's.jsonl');
  writeFileSync(file, lines.join('\n') + '\n');
  const st = statSync(file);

  const usage = await readSessionUsage(file, st.size, st.mtimeMs);
  assert.ok(usage, 'transcript should parse');

  // Session totals DO add up — that is what they are for.
  assert.equal(usage!.cacheReadTokens, 60_000);
  assert.equal(usage!.outputTokens, 600);

  // The context does not. It is the last message's prompt: 5 + 30000 + 50.
  assert.equal(usage!.contextTokens, 30_055);
  assert.ok(
    usage!.contextTokens < usage!.cacheReadTokens,
    'a snapshot must be smaller than the sum it would have been mistaken for',
  );
});

// The window the bar divides by comes from the model catalog, resolved on the
// backend — the phone once kept a three-entry copy of the list, opus-4-8
// drifted out of it, and a 323k context on a 1M-window model wore a bar pegged
// at 100% of 200k.
test('context window rides along from the catalog, dated ids included', async () => {
  const { mkdtempSync, writeFileSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readSessionUsage } = await import('./session-list.js');

  const write = (model: string) => {
    const file = join(mkdtempSync(join(tmpdir(), 'aerie-window-')), 's.jsonl');
    writeFileSync(file, JSON.stringify({
      type: 'assistant',
      message: { model, usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 100 } },
    }) + '\n');
    return { file, st: statSync(file) };
  };

  // Exact catalog id — the one that was missing from the phone's copy.
  const a = write('claude-opus-4-8');
  assert.equal((await readSessionUsage(a.file, a.st.size, a.st.mtimeMs))!.contextWindow, 1_000_000);

  // A transcript's resolved dated id maps onto the catalog's plain form.
  const b = write('claude-opus-4-5-20251101');
  assert.equal((await readSessionUsage(b.file, b.st.size, b.st.mtimeMs))!.contextWindow, 200_000);

  // A model the catalog has never heard of ships no window at all — the
  // phone's fallback default is a visible guess, not a smuggled one.
  const c = write('some-model-nobody-wrote-down');
  assert.equal((await readSessionUsage(c.file, c.st.size, c.st.mtimeMs))!.contextWindow, undefined);
});

// A SYNTHETIC ENTRY IS A DEATH CERTIFICATE, NOT A TURN. Claude Code appends one
// when a session ends on an error — a usage cap, a 529, a bad model id — and it
// carries an all-zero usage block. Reading it as the last assistant message
// named the model '<synthetic>' and sized the context at 0 on the Status app,
// wiping numbers that were sitting intact one line above it.
test('a session that died on an error keeps its real model and context', async () => {
  const { mkdtempSync, writeFileSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readSessionUsage } = await import('./session-list.js');

  const real = JSON.stringify({
    type: 'assistant',
    message: {
      model: 'claude-opus-5',
      usage: {
        input_tokens: 2, output_tokens: 500,
        cache_read_input_tokens: 402_920, cache_creation_input_tokens: 2_558,
      },
    },
  });
  const died = JSON.stringify({
    type: 'assistant',
    message: {
      model: '<synthetic>',
      content: [{ type: 'text', text: "You've hit your session limit · resets 10pm (UTC)" }],
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });
  const file = join(mkdtempSync(join(tmpdir(), 'aerie-synthetic-')), 's.jsonl');
  writeFileSync(file, [real, died].join('\n') + '\n');
  const st = statSync(file);

  const usage = (await readSessionUsage(file, st.size, st.mtimeMs))!;
  assert.ok(usage, 'transcript should parse');
  assert.equal(usage.model, 'claude-opus-5');
  assert.equal(usage.contextTokens, 405_480);
  assert.equal(usage.replies, 1, 'the error notice is not a reply');
  assert.match(usage.endedWith!, /session limit/);
  // The window only resolves because the model survived the synthetic entry.
  assert.ok(usage.contextWindow, 'a real model still resolves its context window');
});

// A session holding nothing but the death certificate still earns a row —
// "empty, and here is why" is information; a silent zero is not.
test('a session with only an error notice still reports why', async () => {
  const { mkdtempSync, writeFileSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readSessionUsage } = await import('./session-list.js');

  const file = join(mkdtempSync(join(tmpdir(), 'aerie-synthetic-only-')), 's.jsonl');
  writeFileSync(file, JSON.stringify({
    type: 'assistant',
    message: {
      model: '<synthetic>',
      content: [{ type: 'text', text: 'There is an issue with the selected model (not-a-model).' }],
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  }) + '\n');
  const st = statSync(file);

  const usage = (await readSessionUsage(file, st.size, st.mtimeMs))!;
  assert.equal(usage.replies, 0);
  assert.equal(usage.model, undefined);
  assert.match(usage.endedWith!, /not-a-model/);
});

// The missed-inbound replay is the owner's own words, but it is not what named the
// session — taking its first line put a raw stamped
// "Name (ISO timestamp): ..." line on the Status app as a title.
test('the missed-message replay loses the title to what they actually said', () => {
  const head = [
    JSON.stringify({
      type: 'user', isMeta: true,
      message: { content: [
        'Stop hook feedback:',
        '[1:53 PM] #aerie Owner: ',
        '[MISSED — 2 messages from the owner reached no turn at all.]',
        'Owner (2026-08-21T05:51:59.209Z): That can wait for now, let us look at the settings page.',
        'Owner (2026-08-21T05:55:21.818Z): I think it is only the header, to be honest.',
        '[End of missed messages.]',
        'Status first: what are we testing before we tidy that block?',
      ].join('\n') },
    }),
  ].join('\n');

  assert.equal(
    parseSessionHead(head).summary,
    'Status first: what are we testing before we tidy that block?',
  );
});

// ...but a turn whose only content IS the replay still gets named, with the
// timestamp furniture stripped. The owner's words beat no words.
test('a replay-only turn falls back to the replayed words, unstamped', () => {
  const head = JSON.stringify({
    type: 'user', isMeta: true,
    message: { content: [
      'Stop hook feedback:',
      '[1:53 PM] #aerie Owner: ',
      '[MISSED — 1 message from the owner reached no turn at all.]',
      'Owner (2026-08-21T05:51:59.209Z): That can wait for now, let us look at the settings page.',
      '[End of missed messages.]',
    ].join('\n') },
  });

  assert.equal(
    parseSessionHead(head).summary,
    'That can wait for now, let us look at the settings page.',
  );
});
