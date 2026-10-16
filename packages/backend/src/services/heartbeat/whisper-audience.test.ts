// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The old-window gate where it actually lives. whisper.test.ts proves the lane
// opens only when asked; this proves the runtime asks only on a turn that is
// the owner's alone — the owner's phone or the house's own wakes — and never on
// a turn that carries an audience, which every Discord turn does, the owner's
// or a guest's.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import Database from 'better-sqlite3';
import type { TurnAudience } from '../turn-audience.js';

// A turn that never got its reply would otherwise wait out the full window.
process.env.AERIE_HEARTBEAT_REPLY_TIMEOUT = '1';

const { loadConfig } = await import('../../config.js');
const { initDb } = await import('../db/init.js');
const { setSecret } = await import('../secrets.js');
const { EMBEDDING_DIM, MODEL_ID, vectorToBuffer } = await import('../embeddings.js');
const { resetArchiveIndex } = await import('../archive-index.js');
const { extractCues, setWhisperEmbedder } = await import('./whisper.js');
const { InteractiveCliRuntime } = await import('./runtime.js');

const dir = mkdtempSync(join(tmpdir(), 'whisper-audience-'));
loadConfig(join(dir, 'no-aerie.yaml')); // defaults only, never the house's aerie.yaml
initDb(':memory:');
setSecret('cortex_mcp_url', 'http://127.0.0.1:9'); // never fetched: the prompt has no cues

const match = new Float32Array(EMBEDDING_DIM);
match[0] = 1;
const PROMPT = 'and then what of the old one';
assert.deepEqual(extractCues(PROMPT), [], 'a cue would send the keyword lane to the network');
setWhisperEmbedder(async () => match);

const INDEX = join(dir, 'archive-index.db');
{
  const db = new Database(INDEX);
  db.exec(`
    CREATE TABLE passages (
      id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL, house TEXT NOT NULL, title TEXT,
      date TEXT, speaker TEXT, text TEXT NOT NULL, embedding BLOB NOT NULL
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  db.prepare('INSERT INTO passages (conversation_id, house, title, date, speaker, text, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('gpt-conv-private', 'gpt', 'private', '2025-03-11', 'Owner', 'a private passage', vectorToBuffer(match));
  db.prepare("INSERT INTO meta (key, value) VALUES ('model', ?)").run(MODEL_ID);
  db.close();
}
resetArchiveIndex(INDEX);

after(() => {
  setWhisperEmbedder(null);
  resetArchiveIndex();
  rmSync(dir, { recursive: true, force: true });
});

interface InboxLine { turn: string; content: string }

/** Just enough of a heartbeat session to carry one turn: whatever lands in
 *  the inbox is answered at once, so the turn closes without a real CLI. */
class FakeSession {
  status = 'running' as const;
  lastError = '';
  dir = dir;
  imagesDir = join(dir, 'images');
  onIncident: ((text: string) => void) | null = null;
  orphanedRepliesPath = join(dir, 'orphans.jsonl');
  lines: string[] = [];
  inbox: InboxLine[] = [];
  ensure() { return false; }
  sideNotesSize() { return 0; }
  sideNotesReadMark() { return ''; }
  readSideNotesFrom() { return { notes: [], newOffset: 0 }; }
  consumeFreshFlag() { return false; }
  outboxSize() { return this.lines.length; }
  activitySize() { return 0; }
  readActivityFrom() { return { lines: [], newOffset: 0 }; }
  busyMtime() { return 0; }
  clearBusy() {}
  requestRestart() {}
  interruptTurn() { return false; }
  appendInbox(line: InboxLine) {
    this.inbox.push(line);
    this.lines.push(JSON.stringify({ turn_id: line.turn, content: 'heard', thinking: 'here' }));
  }
  readOutboxFrom(offset: number) {
    return { lines: this.lines.slice(offset), newOffset: this.lines.length };
  }
}

async function inboxFor(sessionKey: string, audience?: TurnAudience): Promise<string> {
  const session = new FakeSession();
  const runtime = new InteractiveCliRuntime({ sessionKey, audience, sessionFactory: () => session as any });
  for await (const _event of runtime.runTurn({
    prompt: PROMPT,
    model: 'claude-opus-4-5',
    systemPrompt: 'test',
    cwd: dir,
    thinking: 'adaptive' as const,
    maxTurns: 1,
    isAutonomous: false,
  })) { /* drain */ }
  assert.equal(session.inbox.length, 1);
  return session.inbox[0].content;
}

test('the owner\'s old windows ride into the owner\'s own turns and never into a turn with an audience', async () => {
  // The owner's phone (no audience): the passage rides in. This is also the control —
  // the same index and the same perfect match are live for the turns below.
  const home = await inboxFor('audience-home');
  assert.match(home, /From an old window/);
  assert.match(home, /gpt-conv-private/);

  for (const [lane, audience] of [
    ['audience-discord-owner', { kind: 'owner' }],
    ['audience-discord-guest-full', { kind: 'guest', trust: 'full' }],
    ['audience-discord-guest-limited', { kind: 'guest', trust: 'limited' }],
  ] as Array<[string, TurnAudience]>) {
    const content = await inboxFor(lane, audience);
    assert.ok(content.endsWith(PROMPT), `${lane}: the turn itself still arrives`);
    assert.doesNotMatch(content, /From an old window|gpt-conv-private|a private passage/, lane);
  }
});
