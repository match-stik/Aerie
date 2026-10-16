// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A guest's turn is answered into a room the guest reads, and the guest's own
// words would steer anything keyed on them. So nothing of the owner's rides
// into one: no recall, none of the Archivist's unfiled noticings, and none of
// the owner's side notes, which wait for the owner's own next turn. Every source below is
// live, and the owner's turn after each guest turn proves it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { TurnAudience } from '../turn-audience.js';

// A turn that never got its reply would otherwise wait out the full window.
process.env.AERIE_HEARTBEAT_REPLY_TIMEOUT = '1';

const { loadConfig } = await import('../../config.js');
const { initDb } = await import('../db/init.js');
const { getDb } = await import('../db.js');
const { setSecret } = await import('../secrets.js');
const { EMBEDDING_DIM, vectorToBuffer } = await import('../embeddings.js');
const { extractCues, setWhisperEmbedder } = await import('./whisper.js');
const { createSelfKnowledge } = await import('../db/self-knowledge.js');
const { initMemoryProposals, proposeEdit } = await import('../memory-proposals.js');
const { InteractiveCliRuntime } = await import('./runtime.js');

const dir = mkdtempSync(join(tmpdir(), 'guest-turn-context-'));
loadConfig(join(dir, 'no-aerie.yaml')); // defaults only, never the house's aerie.yaml
initDb(':memory:');
initMemoryProposals();
setSecret('cortex_mcp_url', 'http://127.0.0.1:9'); // never fetched: the prompt has no cues

const match = new Float32Array(EMBEDDING_DIM);
match[0] = 1;
const PROMPT = 'and then what of the old one';
assert.deepEqual(extractCues(PROMPT), [], 'a cue would send the keyword lane to the network');
setWhisperEmbedder(async () => match);

// Recall: one accepted truth that matches the prompt exactly. Its embedding
// row carries the hash the index computes for this entry, so the refresh that
// creating it schedules leaves the row alone instead of re-embedding the line
// with the real model, which would no longer match the prompt.
createSelfKnowledge({ id: 'sk-private', companionId: 'willow', category: 'i_learned', content: 'A PRIVATE SELF-KNOWLEDGE LINE', status: 'accepted' });
getDb()
  .prepare('INSERT INTO self_knowledge_embeddings (self_knowledge_id, content_hash, vector, indexed_at) VALUES (?, ?, ?, ?)')
  .run('sk-private', createHash('sha256').update('i learned: A PRIVATE SELF-KNOWLEDGE LINE').digest('hex'), vectorToBuffer(match), new Date().toISOString());

// The Archivist: one unfiled noticing about the owner.
proposeEdit({ op: 'append', scope: 'shared', label: 'human', content: 'A PRIVATE NOTICING ABOUT THE OWNER' });

after(() => {
  setWhisperEmbedder(null);
  rmSync(dir, { recursive: true, force: true });
});

interface InboxLine { turn: string; content: string }

/** Just enough of a heartbeat session to carry turns: whatever lands in the
 *  inbox is answered at once, and it holds one side note of the owner's. */
class FakeSession {
  status = 'running' as const;
  lastError = '';
  dir = dir;
  imagesDir = join(dir, 'images');
  onIncident: ((text: string) => void) | null = null;
  orphanedRepliesPath = join(dir, 'orphans.jsonl');
  lines: string[] = [];
  inbox: InboxLine[] = [];
  fresh = false;
  silent = false;
  notes = [{ at: '2026-03-12T21:00:00.000Z', text: 'A PRIVATE SIDE NOTE OF THE OWNER' }];
  ensure() { return false; }
  sideNotesSize() { return 0; }
  sideNotesReadMark() { return ''; }
  readSideNotesFrom(offset: number) { return { notes: this.notes.slice(offset), newOffset: this.notes.length }; }
  consumeFreshFlag() { const f = this.fresh; this.fresh = false; return f; }
  outboxSize() { return this.lines.length; }
  activitySize() { return 0; }
  readActivityFrom() { return { lines: [], newOffset: 0 }; }
  busyMtime() { return 0; }
  clearBusy() {}
  requestRestart() {}
  interruptTurn() { return false; }
  appendInbox(line: InboxLine) {
    this.inbox.push(line);
    if (!this.silent) this.lines.push(JSON.stringify({ turn_id: line.turn, content: 'heard', thinking: 'here' }));
  }
  readOutboxFrom(offset: number) {
    return { lines: this.lines.slice(offset), newOffset: this.lines.length };
  }
}

const PRIVATE = /PRIVATE SELF-KNOWLEDGE|PRIVATE NOTICING|PRIVATE SIDE NOTE/;

/** One lane, one session, the turns run in order with their own audiences.
 *  `before` runs ahead of each turn, so a test can change the room between
 *  them. */
async function turnsFor(
  sessionKey: string,
  audiences: Array<TurnAudience | undefined>,
  extra: Record<string, unknown> = {},
  before?: (turn: number) => Promise<void> | void,
): Promise<string[]> {
  const session = new FakeSession();
  const contents: string[] = [];
  for (const [turn, audience] of audiences.entries()) {
    await before?.(turn);
    const runtime = new InteractiveCliRuntime({ sessionKey, audience, sessionFactory: () => session as any, ...extra } as any);
    for await (const _event of runtime.runTurn({
      prompt: PROMPT,
      model: 'claude-opus-4-5',
      systemPrompt: 'test',
      cwd: dir,
      thinking: 'adaptive' as const,
      maxTurns: 1,
      isAutonomous: false,
    })) { /* drain */ }
    contents.push(session.inbox[session.inbox.length - 1].content);
  }
  return contents;
}

test("a guest's turn carries none of the owner's private context, at any trust", async () => {
  for (const trust of ['full', 'standard', 'limited'] as const) {
    const [guest] = await turnsFor(`guest-ctx-${trust}`, [{ kind: 'guest', trust }]);
    assert.ok(guest.endsWith(PROMPT), `${trust}: the turn itself still arrives`);
    assert.doesNotMatch(guest, PRIVATE, trust);
  }
});

test('the owner\'s own turns keep all of it, which is what proves the sources are live', async () => {
  const [home] = await turnsFor('guest-ctx-home', [undefined]);
  assert.match(home, /PRIVATE SELF-KNOWLEDGE LINE/);
  assert.match(home, /PRIVATE NOTICING ABOUT THE OWNER/);
  assert.match(home, /PRIVATE SIDE NOTE OF THE OWNER/);
  const [discord] = await turnsFor('guest-ctx-discord-owner', [{ kind: 'owner' }]);
  assert.match(discord, /PRIVATE SIDE NOTE OF THE OWNER/, 'the owner\'s own Discord turn still gets the owner\'s notes');
});

test('a side note held back on a guest turn comes with the owner\'s next turn, late and not lost', async () => {
  const [guest, owners] = await turnsFor('guest-ctx-then-home', [{ kind: 'guest', trust: 'standard' }, undefined]);
  assert.doesNotMatch(guest, /PRIVATE SIDE NOTE/);
  assert.match(owners, /PRIVATE SIDE NOTE OF THE OWNER/);
});

// An owner's message that no turn ever picked up. The net that finds it tells the
// lane to answer it now, so found on a guest's turn it would be answered in
// the guest's room. None of these lanes have a folder under data/heartbeat,
// so the net's own marks and log fail quietly and only the lane's memory of
// where it got to is tested.
type Row = { role: 'user'; content: string; createdAt: string };
function homeThread(rows: Row[]) {
  return { threadId: 't-home', userName: 'Owner', historyLimit: 30, loadHistory: () => rows };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test("the owner's missed message waits for the owner's own turn rather than being answered in a guest's room", async () => {
  const rows: Row[] = [{ role: 'user', content: 'A PRIVATE MISSED MESSAGE OF THE OWNER', createdAt: '2026-03-12T20:00:00.000Z' }];
  const [guest, owners] = await turnsFor('guest-ctx-missed', [{ kind: 'guest', trust: 'standard' }, undefined], homeThread(rows));
  assert.doesNotMatch(guest, /PRIVATE MISSED MESSAGE/);
  assert.match(owners, /PRIVATE MISSED MESSAGE OF THE OWNER/, 'late, and not lost');
});

test("a guest's turn does not move the starting point past a message nobody handed over", async () => {
  // The owner's turn first, with nothing of the owner's in the window, so the
  // lane has the end of a turn to go by and no handover mark. The owner's
  // message lands after it, then a guest's turn ends after that.
  const rows: Row[] = [];
  const [, guest, owners] = await turnsFor(
    'guest-ctx-missed-mark',
    [undefined, { kind: 'guest', trust: 'full' }, undefined],
    homeThread(rows),
    async (turn) => {
      if (turn !== 1) return;
      await tick();
      rows.push({ role: 'user', content: 'A PRIVATE MISSED MESSAGE OF THE OWNER', createdAt: new Date().toISOString() });
      await tick();
    },
  );
  assert.doesNotMatch(guest, /PRIVATE MISSED MESSAGE/);
  assert.match(owners, /PRIVATE MISSED MESSAGE OF THE OWNER/);
});

// One turn on a given session, returning what reached the inbox and the text
// the turn delivered to its room.
async function oneTurn(session: FakeSession, sessionKey: string, audience: TurnAudience | undefined, extra: Record<string, unknown> = {}) {
  const runtime = new InteractiveCliRuntime({ sessionKey, audience, sessionFactory: () => session as any, ...extra } as any);
  let said = '';
  for await (const ev of runtime.runTurn({
    prompt: PROMPT, model: 'claude-opus-4-5', systemPrompt: 'test', cwd: dir,
    thinking: 'adaptive' as const, maxTurns: 1, isAutonomous: false,
  }) as AsyncIterable<any>) {
    if (ev.type === 'text_delta') said += ev.text;
  }
  return { inbox: session.inbox[session.inbox.length - 1].content, said };
}

test("a late reply meant for the owner is not posted in a guest's room, and reaches the owner's next turn", async () => {
  const session = new FakeSession();
  const key = 'guest-ctx-late';
  // The owner's turn outruns its window and is owed.
  session.silent = true;
  await oneTurn(session, key, undefined);
  const owedTurn = session.inbox[session.inbox.length - 1].turn;
  session.silent = false;
  session.lines.push(JSON.stringify({ turn_id: owedTurn, content: 'A LATE ANSWER TO THE OWNER', thinking: 'late' }));
  const guest = await oneTurn(session, key, { kind: 'guest', trust: 'standard' });
  assert.doesNotMatch(guest.said, /A LATE ANSWER TO THE OWNER/);
  const owners = await oneTurn(session, key, undefined);
  assert.match(owners.said, /A LATE ANSWER TO THE OWNER/, 'held, not lost');
});

test("a guest's turn into a fresh room gets none of the owner's history, and the owner's next turn still does", async () => {
  const session = new FakeSession();
  session.fresh = true;
  const history = { threadId: 't-home', userName: 'Owner', historyLimit: 30,
    loadHistory: () => [{ role: 'user', content: 'A PRIVATE LINE FROM THE OWNER THREAD', createdAt: '2026-10-12T20:00:00.000Z' }] };
  const guest = await oneTurn(session, 'guest-ctx-fresh', { kind: 'guest', trust: 'full' }, history);
  assert.doesNotMatch(guest.inbox, /PRIVATE LINE FROM THE OWNER THREAD/);
  const owners = await oneTurn(session, 'guest-ctx-fresh', undefined, history);
  assert.match(owners.inbox, /PRIVATE LINE FROM THE OWNER THREAD/, 'the seed is owed to the owner\'s turn');
});

test("companion replies to the owner since the lane last spoke are not handed into a guest's turn", async () => {
  const session = new FakeSession();
  const key = 'guest-ctx-catchup';
  const rows: any[] = [];
  const history = { threadId: 't-home', userName: 'Owner', historyLimit: 30, loadHistory: () => rows };
  await oneTurn(session, key, undefined, history);
  await new Promise(r => setTimeout(r, 5));
  rows.push({ role: 'companion', content: 'A COMPANION BELL TO THE OWNER', createdAt: new Date().toISOString(), authorName: 'Birch' });
  await new Promise(r => setTimeout(r, 5));
  const guest = await oneTurn(session, key, { kind: 'guest', trust: 'standard' }, history);
  assert.doesNotMatch(guest.inbox, /A COMPANION BELL TO THE OWNER/);
  rows.push({ role: 'user', content: PROMPT, createdAt: new Date(Date.now() + 1000).toISOString() });
  const owners = await oneTurn(session, key, undefined, history);
  assert.match(owners.inbox, /A COMPANION BELL TO THE OWNER/, 'still handed to the owner\'s own next turn');
});
