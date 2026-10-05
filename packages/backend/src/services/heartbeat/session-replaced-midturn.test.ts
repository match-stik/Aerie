// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * A turn whose room went out from under it stops, instead of staring.
 *
 * Seen from the phone before anybody looked at a log: the bash tool calls
 * finished, and the turn just sat there until it timed out.
 *
 * A mid-turn relaunch usually mints a new conversation — shouldResumeLaunch
 * reopens a room only after a backend restart, a setting change or a first
 * watchdog kill — and either way the
 * session now running was handed the LAUNCH PROMPT rather than the user's message,
 * and that prompt tells it in as many words to wait silently and not write to
 * the outbox until a real turn_id arrives. So the turn was waiting for a line
 * from a room under written instruction not to write one. Two correct
 * behaviours pointed straight at each other, and the only possible outcome was
 * the whole window spent in front of the user.
 *
 * The second test is the one that matters most and it is not about speed: a
 * replaced room must NOT count toward the mute-zombie heuristic. Counting it
 * answers a crash by recycling the room that replaced it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentRuntimeEvent } from '../runtimes/types.js';

process.env.AERIE_HEARTBEAT_REPLY_TIMEOUT = '1';
const { InteractiveCliRuntime } = await import('./runtime.js');
const { PROJECT_ROOT } = await import('../../config.js');

interface InboxLine { turn: string }

class Session {
  status = 'running' as const;
  lastError = '';
  dir = '/tmp/aerie-heartbeat-replaced-test';
  imagesDir = '/tmp/aerie-heartbeat-replaced-test/images';
  onIncident: ((text: string) => void) | null = null;
  lines: string[] = [];
  inbox: InboxLine[] = [];
  sideNotes: string[] = [];
  sideNotesRead = '';
  orphanedRepliesPath = '';
  restartCalls = 0;
  /** Reads of the generation. The runtime captures it once before the loop, so
   *  flipping from the second read on is a room replaced the instant polling
   *  began — deterministic, no timers. */
  reads = 0;
  replaced = false;
  get launchGeneration(): number {
    this.reads++;
    return this.replaced && this.reads > 1 ? 2 : 1;
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
  requestRestart() { this.restartCalls++; }
  interruptTurn() { return false; }
  appendInbox(line: InboxLine) { this.inbox.push(line); }
  readOutboxFrom(offset: number) { return { lines: this.lines.slice(offset), newOffset: this.lines.length }; }
}

const input = {
  prompt: 'wake', model: 'claude-opus-4-5', systemPrompt: 'test',
  cwd: PROJECT_ROOT, thinking: 'adaptive' as const, maxTurns: 1, isAutonomous: true,
};

async function collect(runtime: any): Promise<AgentRuntimeEvent[]> {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of runtime.runTurn(input)) events.push(event);
  return events;
}
const lastError = (events: AgentRuntimeEvent[]) =>
  [...events].reverse().find((e: any) => e.type === 'error') as any;

test('a room replaced mid-turn ends the turn and says so', async () => {
  const session = new Session();
  session.replaced = true;
  const runtime = new InteractiveCliRuntime({
    sessionKey: `replaced-${Date.now()}`,
    sessionFactory: () => session as any,
  } as any);

  const err = lastError(await collect(runtime));
  assert.equal(err?.code, 'heartbeat_session_replaced');
  assert.match(err.message, /replaced while this turn was open/);
  assert.match(err.message, /new conversation/);
});

test('and it is not counted as a mute zombie — the new room is not recycled for the old one dying', async () => {
  const session = new Session();
  session.replaced = true;
  const runtime = new InteractiveCliRuntime({
    sessionKey: `replaced-twice-${Date.now()}`,
    sessionFactory: () => session as any,
  } as any);

  // Two in a row. Under the plain silent path this is exactly what trips the
  // recycle; a replaced room must never reach it.
  session.reads = 0; await collect(runtime);
  session.reads = 0; await collect(runtime);
  assert.equal(session.restartCalls, 0);
});

test('a room that did NOT change still takes the ordinary timeout path', async () => {
  const session = new Session(); // replaced stays false
  const runtime = new InteractiveCliRuntime({
    sessionKey: `not-replaced-${Date.now()}`,
    sessionFactory: () => session as any,
  } as any);

  const err = lastError(await collect(runtime));
  assert.equal(err?.code, 'heartbeat_timeout');
});

test('two ordinary silent turns DO trip the recycle — the control that proves the test discriminates', async () => {
  const session = new Session();
  const runtime = new InteractiveCliRuntime({
    sessionKey: `zombie-${Date.now()}`,
    sessionFactory: () => session as any,
  } as any);

  await collect(runtime);
  await collect(runtime);
  assert.equal(session.restartCalls, 1);
});
