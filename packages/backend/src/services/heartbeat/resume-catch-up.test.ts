// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRuntimeEvent } from '../runtimes/types.js';

// Keep the timeout leg short; this module is imported only by this worker.
process.env.AERIE_HEARTBEAT_REPLY_TIMEOUT = '1';

const { InteractiveCliRuntime, TURN_WATERMARK_FILE, ROOM_WATERMARK_FILE } = await import('./runtime.js');
const { PROJECT_ROOT } = await import('../../config.js');

interface Handed { turn: string; content?: string }

class FakeSession {
  status = 'running' as const;
  lastError = '';
  imagesDir = '';
  onIncident: ((text: string) => void) | null = null;
  lines: string[] = [];
  inbox: Handed[] = [];
  sideNotes: string[] = [];
  sideNotesRead = '';
  orphanedRepliesPath = '';
  constructor(public dir: string) {
    mkdirSync(join(dir, 'io'), { recursive: true });
    this.imagesDir = join(dir, 'images');
  }
  ensure() { return false; }
  sideNotesSize() { return this.sideNotes.length; }
  sideNotesReadMark() { return this.sideNotesRead; }
  readSideNotesFrom() { return { notes: [], newOffset: 0 }; }
  consumeFreshFlag() { return false; }
  outboxSize() { return this.lines.length; }
  activitySize() { return 0; }
  readActivityFrom() { return { lines: [], newOffset: 0 }; }
  busyMtime() { return 0; }
  clearBusy() {}
  requestRestart() {}
  interruptTurn() { return false; }
  appendInbox(line: Handed) { this.inbox.push(line); }
  readOutboxFrom(offset: number) { return { lines: this.lines.slice(offset), newOffset: this.lines.length }; }
}

const THREAD = 'thread-resume-catchup';

function makeRuntime(session: FakeSession, key: string, history: Array<{ role: string; content: string; createdAt: string; authorName?: string }>) {
  return new InteractiveCliRuntime({
    sessionKey: key,
    sessionFactory: () => session as any,
    threadId: THREAD,
    historyLimit: 30,
    companionName: 'Willow',
    userName: 'Owner',
    loadHistory: () => history as any,
  } as any);
}

async function runOnce(runtime: any) {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of runtime.runTurn({
    prompt: 'bell',
    model: 'claude-opus-4-5',
    systemPrompt: 'test',
    cwd: PROJECT_ROOT,
    thinking: 'adaptive' as const,
    maxTurns: 1,
    isAutonomous: true,
  })) events.push(event);
  return events;
}

// The hole, stated as a test: a room reopened by --resume after a backend
// restart has an EMPTY laneStates map, so before the stamp was persisted the
// catch-up was gated on a value that could not exist and handed over nothing.
test('a lane with no turn stamp is handed the window rather than nothing', async () => {
  const dir = `/tmp/aerie-resume-nostamp-${Date.now()}`;
  const session = new FakeSession(dir);
  const runtime = makeRuntime(session, `nostamp-${Date.now()}`, [
    { role: 'companion', content: 'first bell of the evening run', createdAt: '2026-09-09T23:31:00.000Z', authorName: 'Birch' },
    { role: 'user', content: 'oh boy ... hmmm', createdAt: '2026-09-10T00:02:00.000Z' },
  ]);

  await runOnce(runtime);
  const handed = (session.inbox[0] as any).content as string;

  assert.match(handed, /While you were quiet/, 'no stamp must not mean no catch-up');
  assert.match(handed, /first bell of the evening run/);
  rmSync(dir, { recursive: true, force: true });
});

// And the other half: once a turn has run, the stamp is on disk and survives
// the map being empty, so the NEXT lane state built for that directory bounds
// the catch-up at it instead of replaying the room.
test('the turn stamp is written to disk and bounds a later lane state', async () => {
  const dir = `/tmp/aerie-resume-stamp-${Date.now()}`;
  const session = new FakeSession(dir);
  const first = makeRuntime(session, `stamp-a-${Date.now()}`, []);
  await runOnce(first);

  const stampPath = join(dir, 'io', TURN_WATERMARK_FILE);
  const stamp = readFileSync(stampPath, 'utf8').trim();
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'a turn must leave a readable stamp');

  // A different lane key is a lane state built from scratch — the same thing a
  // backend restart does, without reaching into the module's map.
  const before = new Date(Date.parse(stamp) - 60_000).toISOString();
  const after = new Date(Date.parse(stamp) + 60_000).toISOString();
  const second = makeRuntime(new FakeSession(dir), `stamp-b-${Date.now()}`, [
    { role: 'companion', content: 'said before the stamp', createdAt: before, authorName: 'Birch' },
    { role: 'companion', content: 'said after the stamp', createdAt: after, authorName: 'Cedar' },
  ]);
  const secondSession = (second as any).options.sessionFactory() as FakeSession;
  await runOnce(second);
  const handed = (secondSession.inbox[0] as any).content as string;

  assert.match(handed, /said after the stamp/, 'the room kept talking and that must be handed over');
  assert.doesNotMatch(handed, /said before the stamp/, 'a persisted stamp must bound the catch-up');
  rmSync(dir, { recursive: true, force: true });
});

// Absent means unknown, never "already seen" — the same one-way doctrine the
// handover watermark runs on. A damaged file must fail toward too much.
test('a damaged turn stamp reads as unknown and still hands the window over', async () => {
  const dir = `/tmp/aerie-resume-damaged-${Date.now()}`;
  const session = new FakeSession(dir);
  writeFileSync(join(dir, 'io', TURN_WATERMARK_FILE), 'not-a-timestamp', 'utf8');
  const runtime = makeRuntime(session, `damaged-${Date.now()}`, [
    { role: 'companion', content: 'the room kept going', createdAt: '2026-09-10T00:02:00.000Z', authorName: 'Birch' },
  ]);

  await runOnce(runtime);
  const handed = (session.inbox[0] as any).content as string;
  assert.match(handed, /the room kept going/, 'a damaged stamp must not suppress the catch-up');
  rmSync(dir, { recursive: true, force: true });
});

// Sep 24 2026: a fresh room held the lane for an hour and moved the marks to
// its own last turn, then a resume reopened the OLD room, which was handed
// everything since the fresh room's turn — nothing. Marks written by another
// room say nothing about what this room saw.
test('marks written by a different room do not bound a reopened room', async () => {
  const dir = `/tmp/aerie-resume-otherroom-${Date.now()}`;
  const stamp = '2026-09-24T12:30:00.000Z';
  const make = (room: string, key: string) => {
    const session = new FakeSession(dir) as any;
    session.currentSessionId = room;
    writeFileSync(join(dir, 'io', TURN_WATERMARK_FILE), stamp, 'utf8');
    writeFileSync(join(dir, 'io', ROOM_WATERMARK_FILE), 'room-fresh', 'utf8');
    const runtime = makeRuntime(session, key, [
      { role: 'companion', content: 'the morning the other room lived through', createdAt: '2026-09-24T12:10:00.000Z', authorName: 'Cedar' },
    ]);
    return { session, runtime };
  };

  const reopened = make('room-old', `otherroom-a-${Date.now()}`);
  await runOnce(reopened.runtime);
  assert.match((reopened.session.inbox[0] as any).content, /the morning the other room lived through/,
    'a room reopened into another room\'s marks must be handed the window');
  assert.equal(readFileSync(join(dir, 'io', ROOM_WATERMARK_FILE), 'utf8').trim(), 'room-old',
    'the turn must claim the marks for the room that wrote them');

  const same = make('room-fresh', `otherroom-b-${Date.now()}`);
  await runOnce(same.runtime);
  assert.doesNotMatch((same.session.inbox[0] as any).content, /the morning the other room lived through/,
    'the room that wrote the marks is still bounded by them');
  rmSync(dir, { recursive: true, force: true });
});
