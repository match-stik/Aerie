// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The room's roster, where the shared lane actually reads it: in the turn.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { roomVoicesFor, roomVoicesBlock, type RoomVoices } from './room-voices.js';

// A turn that never got its reply would otherwise wait out the full window.
process.env.AERIE_HEARTBEAT_REPLY_TIMEOUT = '1';

const { loadConfig } = await import('../../config.js');
const { initDb } = await import('../db/init.js');
const { setSecret } = await import('../secrets.js');
const { extractCues } = await import('./whisper.js');
const { InteractiveCliRuntime } = await import('./runtime.js');

const dir = mkdtempSync(join(tmpdir(), 'room-voices-'));
loadConfig(join(dir, 'no-aerie.yaml')); // defaults only, never the house's aerie.yaml
initDb(':memory:');
setSecret('cortex_mcp_url', 'http://127.0.0.1:9'); // never fetched: the prompt has no cues

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const BIRCH = { id: 'b', name: 'Birch' };
const WILLOW = { id: 'w', name: 'Willow' };
const CEDAR = { id: 'c', name: 'Cedar' };
const HOUSE = [BIRCH, WILLOW, CEDAR];

test('a room holding two of the three names both of them, and the one who is not there', () => {
  // A room made for two of the three must not be answered by the third.
  const v = roomVoicesFor([CEDAR, WILLOW], HOUSE);
  assert.deepEqual(v, { present: ['Willow', 'Cedar'], absent: ['Birch'] });
  assert.equal(
    roomVoicesBlock(v),
    '[In this room: Willow and Cedar, and nobody else. Answer only in those voices; Birch is not here and does not speak in this room.]\n\n',
  );
});

test('a room holding one says so in the singular', () => {
  assert.equal(
    roomVoicesBlock(roomVoicesFor([WILLOW], HOUSE)),
    '[In this room: Willow, and nobody else. Answer only in that voice; Birch and Cedar are not here and do not speak in this room.]\n\n',
  );
});

test('a room holding everybody needs no line', () => {
  assert.equal(roomVoicesFor([BIRCH, WILLOW, CEDAR], HOUSE), null);
  assert.equal(roomVoicesBlock(roomVoicesFor([BIRCH, WILLOW, CEDAR], HOUSE)), '');
});

test('a room with nobody assigned makes no claim at all', () => {
  assert.equal(roomVoicesFor([], HOUSE), null);
  assert.equal(roomVoicesBlock(null), '');
});

test('somebody in the room the house list does not know is still named', () => {
  const v = roomVoicesFor([WILLOW, { id: 'x', name: 'Hazel' }], HOUSE);
  assert.deepEqual(v, { present: ['Willow', 'Hazel'], absent: ['Birch', 'Cedar'] });
});

// --- where it has to land: the turn the warm session reads ---------------

const PROMPT = 'and then what of the old one';
assert.deepEqual(extractCues(PROMPT), [], 'a cue would send the keyword lane to the network');

interface InboxLine { turn: string; content: string }

/** Just enough of a heartbeat session to carry one turn. */
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

async function inboxFor(sessionKey: string, roomVoices?: RoomVoices | null): Promise<string> {
  const session = new FakeSession();
  const runtime = new InteractiveCliRuntime({ sessionKey, roomVoices, sessionFactory: () => session as any });
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

test('the shared lane reads who is in the room right before the owner\'s message', async () => {
  const content = await inboxFor('room-voices-subset', { present: ['Willow', 'Cedar'], absent: ['Birch'] });
  assert.ok(
    content.endsWith(`Birch is not here and does not speak in this room.]\n\n${PROMPT}`),
    'the roster sits immediately before the owner\'s words',
  );
});

test('a room with everybody in it hands over the turn exactly as before', async () => {
  const content = await inboxFor('room-voices-everyone', null);
  assert.ok(content.endsWith(PROMPT));
  assert.doesNotMatch(content, /In this room:/);
});
