// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRuntimeEvent } from '../runtimes/types.js';

// Keep the intentional timeout leg short. This module is imported only by
// this test worker, so production defaults and other test workers are intact.
process.env.AERIE_HEARTBEAT_REPLY_TIMEOUT = '1';

const {
  InteractiveCliRuntime,
  isHeartbeatSilenceSentinel,
  localStudioGalleryPath,
  pickOrphanedImage,
} = await import('./runtime.js');
const { PROJECT_ROOT } = await import('../../config.js');
const { deleteFile, saveFile } = await import('../files.js');

interface InboxLine { turn: string }

class FakeHeartbeatSession {
  status = 'running' as const;
  lastError = '';
  dir = '/tmp/aerie-heartbeat-test';
  imagesDir = '/tmp/aerie-heartbeat-test/images';
  onIncident: ((text: string) => void) | null = null;
  lines: string[] = [];
  inbox: InboxLine[] = [];
  clearBusyCalls = 0;
  onAppend: ((line: InboxLine) => void) | null = null;

  sideNotes: string[] = [];
  sideNotesRead = '';
  orphanedRepliesPath = '';
  ensure() { return false; }
  sideNotesSize() { return this.sideNotes.length; }
  sideNotesReadMark() { return this.sideNotesRead; }
  readSideNotesFrom(offset: number) {
    const lines = this.sideNotes.slice(offset);
    const notes: Array<{ at: string; text: string }> = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed?.text) notes.push({ at: parsed.at ?? '', text: parsed.text });
      } catch { /* partial line */ }
    }
    return { notes, newOffset: this.sideNotes.length };
  }
  consumeFreshFlag() { return false; }
  outboxSize() { return this.lines.length; }
  activitySize() { return 0; }
  readActivityFrom() { return { lines: [], newOffset: 0 }; }
  busyMtime() { return 0; }
  clearBusy() { this.clearBusyCalls++; }
  requestRestart() {}
  interruptTurn() { return false; }
  appendInbox(line: InboxLine) {
    this.inbox.push(line);
    this.onAppend?.(line);
  }
  readOutboxFrom(offset: number) {
    return { lines: this.lines.slice(offset), newOffset: this.lines.length };
  }
}

const input = {
  prompt: 'wake',
  model: 'claude-opus-4-5',
  systemPrompt: 'test',
  cwd: PROJECT_ROOT,
  thinking: 'adaptive' as const,
  maxTurns: 1,
  isAutonomous: true,
};

async function collect(runtime: InstanceType<typeof InteractiveCliRuntime>) {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of runtime.runTurn(input)) events.push(event);
  return events;
}

test('recognizes only the exact heartbeat silence sentinel', () => {
  assert.equal(isHeartbeatSilenceSentinel(' [SILENT]\n'), true);
  assert.equal(isHeartbeatSilenceSentinel('late reply\n\n[SILENT]'), false);
  assert.equal(isHeartbeatSilenceSentinel('[silent]'), false);
});

test('resolves only safe same-house Studio gallery URLs', () => {
  const expected = join(PROJECT_ROOT, 'data', 'generated-images', 'frame.png');
  assert.equal(localStudioGalleryPath('/api/studio/gallery/frame.png'), expected);
  assert.equal(localStudioGalleryPath('http://127.0.0.1:3003/api/studio/gallery/frame.png'), expected);
  assert.equal(localStudioGalleryPath('http://[::1]:3003/api/studio/gallery/frame.png'), expected);
  assert.equal(localStudioGalleryPath('https://example.com/api/studio/gallery/frame.png'), null);
  assert.equal(localStudioGalleryPath('/api/studio/gallery/%2e%2e%2Fsecret.png'), null);
  assert.equal(localStudioGalleryPath('/api/studio/gallery/frame.txt'), null);
});

// A reply written AFTER its turn's final line is an orphan: the live path never
// consumed it and its turn is no longer owed, so the sweep is the only thing that
// could carry it and it does not. That used to happen on a bare `continue` with no
// log and no trace, so a finished reply could vanish and the only witness was the
// owner noticing they never got an answer. It still is not delivered — only the
// offset proves it was never sent — but the text is preserved and the loss is loud.
test('an outbox line for an already-resolved turn is preserved instead of vanishing', async () => {
  const orphanPath = `/tmp/aerie-orphan-${Date.now()}.jsonl`;
  const session = new FakeHeartbeatSession();
  session.orphanedRepliesPath = orphanPath;
  const runtime = new InteractiveCliRuntime({
    sessionKey: `orphan-${Date.now()}`,
    sessionFactory: () => session as any,
  });

  await collect(runtime); // time out once so a DIFFERENT turn is genuinely owed
  const owedTurn = session.inbox[0].turn;
  // The sweep runs BEFORE appendInbox, so it only ever sees lines written during
  // earlier turns — which is exactly the shape of the fault: a line stamped with a
  // turn that had already closed, sitting in the outbox when the next turn opens.
  session.lines.push(JSON.stringify({ turn_id: 'closed-turn-abc123', content: 'the five scenes' }));
  session.onAppend = (current) => {
    if (current.turn === owedTurn) return;
    session.lines.push(JSON.stringify({ turn_id: current.turn, content: 'current reply' }));
  };

  const events = await collect(runtime);
  const text = events.filter((event: any) => event.type === 'text_delta').map((event: any) => event.text).join('');

  // Not delivered — the guard still holds, on purpose.
  assert.doesNotMatch(text, /the five scenes/);
  // But no longer lost: recoverable by hand, with the turn it was stamped with.
  assert.ok(existsSync(orphanPath), 'orphaned reply file should exist');
  const recorded = readFileSync(orphanPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].content, 'the five scenes');
  assert.equal(recorded[0].turn_id, 'closed-turn-abc123');
  // The genuinely owed turn is untouched by any of this.
  assert.ok(session.lines.length > 0);
  rmSync(orphanPath, { force: true });
});

test('a late reply followed by current SILENT keeps only the late reply and its thought', async () => {
  const session = new FakeHeartbeatSession();
  const runtime = new InteractiveCliRuntime({
    sessionKey: `silence-live-${Date.now()}`,
    sessionFactory: () => session as any,
  });

  await collect(runtime); // timeout once so its turn id enters the owed ledger
  const owedTurn = session.inbox[0].turn;
  session.onAppend = (current) => {
    if (current.turn === owedTurn) return;
    session.lines.push(
      JSON.stringify({ turn_id: owedTurn, content: 'late reply', thinking: 'late thought' }),
      JSON.stringify({ turn_id: current.turn, content: '[SILENT]', thinking: 'current silent thought' }),
    );
  };

  const events = await collect(runtime);
  const text = events.filter((event: any) => event.type === 'text_delta').map((event: any) => event.text).join('');
  const thoughts = events.filter((event: any) => event.type === 'thinking_delta').map((event: any) => event.text).join('\n');
  assert.equal(text, 'late reply');
  assert.match(thoughts, /late thought/);
  assert.doesNotMatch(thoughts, /current silent thought/);
  assert.equal(events.at(-1)?.type, 'done');
  // The turn is silent AND carrying owed words: it still reports the silence,
  // and the router keeps the reply because text landed.
  assert.equal((events.at(-1) as any)?.finishReason, 'silent');
});

// A CLI relaunch resumes the transcript, so a session killed mid-turn comes
// back, finishes the thought it was holding and writes that line minutes
// later. The owed-turn ledger has to survive the relaunch or that finished
// reply has no ticket and is skipped on sight.
test('a session relaunch keeps the owed-turn ledger, so a resumed reply still lands', async () => {
  const session = new FakeHeartbeatSession();
  let relaunched = false;
  session.consumeFreshFlag = () => {
    const wasFresh = relaunched;
    relaunched = false;
    return wasFresh;
  };
  const runtime = new InteractiveCliRuntime({
    sessionKey: `relaunch-ledger-${Date.now()}`,
    sessionFactory: () => session as any,
  });

  await collect(runtime); // times out — this turn id enters the owed ledger
  const owedTurn = session.inbox[0].turn;

  // The session died mid-turn and relaunched; the resumed transcript finished
  // the reply and wrote it to the outbox after the relaunch.
  relaunched = true;
  session.lines.push(JSON.stringify({ turn_id: owedTurn, content: 'reply written after the relaunch' }));

  const events = await collect(runtime);
  const text = events.filter((event: any) => event.type === 'text_delta').map((event: any) => event.text).join('');
  assert.match(text, /reply written after the relaunch/);
});

test('a deliberately silent wake reports the silent finish reason, not an empty complete', async () => {
  const session = new FakeHeartbeatSession();
  const runtime = new InteractiveCliRuntime({
    sessionKey: `silence-reason-${Date.now()}`,
    sessionFactory: () => session as any,
  });

  session.onAppend = (current) => {
    session.lines.push(JSON.stringify({
      turn_id: current.turn,
      content: '[SILENT]',
      thinking: 'nothing needed saying',
    }));
  };

  const events = await collect(runtime);
  assert.equal(events.filter((event: any) => event.type === 'text_delta').length, 0);
  assert.equal(events.at(-1)?.type, 'done');
  assert.equal((events.at(-1) as any)?.finishReason, 'silent');
});

test('the initial late sweep preserves UUID and local Studio image attachments', async () => {
  const session = new FakeHeartbeatSession();
  const runtime = new InteractiveCliRuntime({
    sessionKey: `silence-sweep-${Date.now()}`,
    sessionFactory: () => session as any,
  });

  await collect(runtime);
  const owedTurn = session.inbox[0].turn;
  const existing = saveFile(Buffer.from('existing-image'), 'existing.png', 'image/png');
  const galleryName = `heartbeat-runtime-test-${Date.now()}.png`;
  const galleryDir = join(PROJECT_ROOT, 'data', 'generated-images');
  const galleryPath = join(galleryDir, galleryName);
  mkdirSync(galleryDir, { recursive: true });
  writeFileSync(galleryPath, Buffer.from('studio-image'));

  session.lines.push(JSON.stringify({
    turn_id: owedTurn,
    content: 'late image reply',
    attachments: [{ fileId: existing.fileId }],
    imageUrls: [`/api/studio/gallery/${galleryName}`],
  }));
  session.onAppend = (current) => {
    if (current.turn !== owedTurn) {
      session.lines.push(JSON.stringify({ turn_id: current.turn, content: '[SILENT]' }));
    }
  };

  const events = await collect(runtime);
  const attachments = events.filter((event: any) => event.type === 'attachment') as any[];
  assert.equal(attachments.length, 2);
  assert.equal(attachments[0].fileId, existing.fileId);
  assert.match(attachments[1].url, /^\/api\/files\/[0-9a-f-]+$/);
  assert.equal(events.filter((event: any) => event.type === 'text_delta').map((event: any) => event.text).join(''), 'late image reply');

  deleteFile(existing.fileId);
  deleteFile(attachments[1].fileId);
  unlinkSync(galleryPath);
});

test('a first reply that omits turn_id still keeps its Studio attachment', async () => {
  const session = new FakeHeartbeatSession();
  const runtime = new InteractiveCliRuntime({
    sessionKey: `fallback-image-${Date.now()}`,
    sessionFactory: () => session as any,
  });
  const galleryName = `heartbeat-runtime-fallback-${Date.now()}.png`;
  const galleryDir = join(PROJECT_ROOT, 'data', 'generated-images');
  const galleryPath = join(galleryDir, galleryName);
  // Makes its own directory. It used to rely on an earlier test having made
  // one, so deleting or skipping that test broke this one from two hundred
  // lines away.
  mkdirSync(galleryDir, { recursive: true });
  writeFileSync(galleryPath, Buffer.from('studio-image'));
  session.onAppend = () => {
    session.lines.push(JSON.stringify({
      content: 'image without an id',
      imageUrls: [`/api/studio/gallery/${galleryName}`],
    }));
  };

  const events = await collect(runtime);
  const attachment = events.find((event: any) => event.type === 'attachment') as any;
  assert.ok(attachment);
  assert.equal(events.filter((event: any) => event.type === 'text_delta').map((event: any) => event.text).join(''), 'image without an id');

  deleteFile(attachment.fileId);
  unlinkSync(galleryPath);
});

after(() => {
  delete process.env.AERIE_HEARTBEAT_REPLY_TIMEOUT;
});

// ─── Orphaned Studio images ─────────────────────────────────────────
// A turn can finish a picture and then die before writing the line that
// carries it. Recovery reattaches that image; it never regenerates.

const TURN_START = 1_000_000;

function job(over: Record<string, unknown> = {}) {
  return {
    status: 'completed' as const,
    result: { filename: 'img_a.png' } as any,
    createdAt: TURN_START + 10,
    completedAt: TURN_START + 20,
    ...over,
  };
}

test('recovers the image a stalled turn already finished', () => {
  assert.equal(pickOrphanedImage([job()], TURN_START, new Set()), 'img_a.png');
});

test('recovers nothing when the turn made no image', () => {
  assert.equal(pickOrphanedImage([], TURN_START, new Set()), null);
});

test('ignores jobs that never completed', () => {
  const jobs = [
    job({ status: 'running', result: undefined }),
    job({ status: 'failed', result: undefined }),
    job({ status: 'pending', result: undefined }),
  ];
  assert.equal(pickOrphanedImage(jobs as any, TURN_START, new Set()), null);
});

test('ignores a generation that started before this turn', () => {
  // The owner's own Studio run, still finishing while our turn stalled.
  const hers = job({ createdAt: TURN_START - 5_000, result: { filename: 'hers.png' } as any });
  assert.equal(pickOrphanedImage([hers], TURN_START, new Set()), null);
});

test('does not hand over a picture the turn already delivered', () => {
  assert.equal(pickOrphanedImage([job()], TURN_START, new Set(['img_a.png'])), null);
});

test('carries only the newest picture when a turn made several', () => {
  const jobs = [
    job({ result: { filename: 'older.png' } as any, completedAt: TURN_START + 20 }),
    job({ result: { filename: 'newest.png' } as any, completedAt: TURN_START + 90 }),
    job({ result: { filename: 'middle.png' } as any, completedAt: TURN_START + 50 }),
  ];
  assert.equal(pickOrphanedImage(jobs as any, TURN_START, new Set()), 'newest.png');
});

test('falls back to creation time when a job never stamped completion', () => {
  const jobs = [
    job({ result: { filename: 'stamped.png' } as any, completedAt: TURN_START + 30 }),
    job({ result: { filename: 'unstamped.png' } as any, createdAt: TURN_START + 60, completedAt: undefined }),
  ];
  assert.equal(pickOrphanedImage(jobs as any, TURN_START, new Set()), 'unstamped.png');
});

test('an unfinished tool call holds the reply window open', async () => {
  // The window is 1s in this worker. A tool that started and hasn't reported
  // back is still working, so a reply landing well past that must survive —
  // this is what makes a long blocking command safe without guessing at it.
  const session: any = new FakeHeartbeatSession();
  const activity: string[] = [];
  session.activitySize = () => activity.length;
  session.readActivityFrom = (offset: number) => ({ lines: activity.slice(offset), newOffset: activity.length });

  const runtime = new InteractiveCliRuntime({
    sessionKey: `open-tool-${Date.now()}`,
    sessionFactory: () => session,
  });

  session.onAppend = (current: InboxLine) => {
    // A long command starts and never posts back inside the window.
    activity.push(JSON.stringify({ ts: new Date().toISOString(), phase: 'pre', id: 'tool-1', tool: 'Bash', detail: 'a very long job' }));
    setTimeout(() => {
      session.lines.push(JSON.stringify({ turn_id: current.turn, content: 'finished at last' }));
    }, 2_200);
  };

  const events = await collect(runtime);
  const text = events.filter((event: any) => event.type === 'text_delta').map((event: any) => event.text).join('');

  assert.match(text, /finished at last/);
  assert.equal(events.some((event: any) => event.type === 'error'), false);
});

test('a chunked reply closes each mid-turn chunk as its own message', async () => {
  const session = new FakeHeartbeatSession();
  const runtime = new InteractiveCliRuntime({
    sessionKey: `chunk-break-${Date.now()}`,
    sessionFactory: () => session as any,
  });

  session.onAppend = (current) => {
    session.lines.push(
      JSON.stringify({ turn_id: current.turn, content: 'on it', thinking: 'acking first', more: true }),
      JSON.stringify({ turn_id: current.turn, content: 'halfway', more: true }),
      JSON.stringify({ turn_id: current.turn, content: 'done', thinking: 'finished' }),
    );
  };

  const events = await collect(runtime);
  const shape = events
    .filter((event: any) => event.type === 'text_delta' || event.type === 'message_break')
    .map((event: any) => (event.type === 'message_break' ? '|' : event.text));

  // A break after each non-final chunk, and none after the last one — the
  // final chunk is closed by the turn ending, not by a break.
  assert.deepEqual(shape, ['on it', '|', 'halfway', '|', 'done']);
  assert.equal(events.at(-1)?.type, 'done');
});

test('an unchunked reply produces no message breaks', async () => {
  const session = new FakeHeartbeatSession();
  const runtime = new InteractiveCliRuntime({
    sessionKey: `chunk-single-${Date.now()}`,
    sessionFactory: () => session as any,
  });

  session.onAppend = (current) => {
    session.lines.push(JSON.stringify({ turn_id: current.turn, content: 'one and done' }));
  };

  const events = await collect(runtime);
  assert.equal(events.some((event: any) => event.type === 'message_break'), false);
});

test('a side note nobody read is handed over at the start of the next turn, once', async () => {
  const session = new FakeHeartbeatSession();
  const runtime = new InteractiveCliRuntime({
    sessionKey: `side-note-${Date.now()}`,
    sessionFactory: () => session as any,
  });

  session.onAppend = (current) => {
    session.lines.push(JSON.stringify({ turn_id: current.turn, content: 'answered' }));
  };

  await collect(runtime);
  // Written while that turn was working, and never read from the file.
  session.sideNotes.push(JSON.stringify({ at: '2026-07-25T07:00:00.000Z', text: 'back in five, keep going' }));

  await collect(runtime);
  const carried = session.inbox.at(-1) as any;
  assert.match(carried.content, /while you were working/i);
  assert.match(carried.content, /back in five, keep going/);

  // The cursor moved: it is delivered late, not on every turn forever.
  await collect(runtime);
  const after = session.inbox.at(-1) as any;
  assert.doesNotMatch(after.content, /back in five, keep going/);
});

test('a side note the session already answered is still handed over, only labelled', async () => {
  const session = new FakeHeartbeatSession();
  const runtime = new InteractiveCliRuntime({
    sessionKey: `side-note-mark-${Date.now()}`,
    sessionFactory: () => session as any,
  });

  session.onAppend = (current) => {
    session.lines.push(JSON.stringify({ turn_id: current.turn, content: 'answered' }));
  };

  await collect(runtime);
  session.sideNotes.push(JSON.stringify({ at: '2026-07-25T07:00:00.000Z', text: 'picked this one up live' }));
  session.sideNotes.push(JSON.stringify({ at: '2026-07-25T07:05:00.000Z', text: 'this one landed after' }));
  // The session claims only the first one.
  session.sideNotesRead = '2026-07-25T07:00:00.000Z';

  await collect(runtime);
  const carried = session.inbox.at(-1) as any;
  // The claim never suppresses: both notes are handed over regardless.
  assert.match(carried.content, /picked this one up live/);
  assert.match(carried.content, /this one landed after/);
  // Only the claimed one carries the label.
  assert.match(carried.content, /picked this one up live {2}\[you picked this up live/);
  assert.doesNotMatch(carried.content, /this one landed after {2}\[/);
  // Something is genuinely unread, so the header still asks for an answer.
  assert.match(carried.content, /not read at the time/i);
});

test('a mark the session never wrote leaves every note unlabelled', async () => {
  const session = new FakeHeartbeatSession();
  const runtime = new InteractiveCliRuntime({
    sessionKey: `side-note-nomark-${Date.now()}`,
    sessionFactory: () => session as any,
  });

  session.onAppend = (current) => {
    session.lines.push(JSON.stringify({ turn_id: current.turn, content: 'answered' }));
  };

  await collect(runtime);
  session.sideNotes.push(JSON.stringify({ at: '2026-07-25T07:00:00.000Z', text: 'unclaimed note' }));

  await collect(runtime);
  const carried = session.inbox.at(-1) as any;
  assert.match(carried.content, /unclaimed note/);
  assert.doesNotMatch(carried.content, /already answered/i);
  assert.match(carried.content, /not read at the time/i);
});

// ─── Multi-lane recycle seed ──────────────────────────────────────────
// A recycled lane used to read every voice in the room stamped with its own
// name, and came back writing all three headers in one message.

function seedRuntime(companionName: string) {
  return new InteractiveCliRuntime({
    sessionKey: 'test-lane',
    companionName,
    userName: 'Owner',
    threadId: 't1',
    historyLimit: 10,
    loadHistory: () => [
      { role: 'user', content: 'shorten your messages', createdAt: '2026-07-30T11:00:00Z' },
      { role: 'companion', content: 'Cutting it, love.', createdAt: '2026-07-30T11:00:01Z', authorName: 'Willow' },
      { role: 'companion', content: 'Short from here.', createdAt: '2026-07-30T11:00:02Z', authorName: 'Birch' },
      { role: 'companion', content: 'no author recorded', createdAt: '2026-07-30T11:00:03Z' },
    ],
  } as never);
}

test('a recycle seed attributes each voice in the room to its real author', async () => {
  const seed: string = await (seedRuntime('Birch') as never as { buildRecycleContext(): Promise<string> }).buildRecycleContext();
  assert.match(seed, /^Willow: Cutting it, love\.$/m);
  assert.match(seed, /^Birch: Short from here\.$/m);
  // An unattributed companion line still falls back to this lane's own name.
  assert.match(seed, /^Birch: no author recorded$/m);
  assert.match(seed, /^Owner: shorten your messages$/m);
});

test('a recycle seed in a shared room names which voice this lane speaks as', async () => {
  const seed: string = await (seedRuntime('Birch') as never as { buildRecycleContext(): Promise<string> }).buildRecycleContext();
  assert.match(seed, /Willow share this thread/);
  assert.match(seed, /you are Birch and you speak only as Birch, never for them/);
});

test('a recycle seed for a lane alone in its thread keeps the plain closing', async () => {
  const solo = new InteractiveCliRuntime({
    sessionKey: 'test-lane',
    companionName: 'Birch',
    userName: 'Owner',
    threadId: 't1',
    historyLimit: 10,
    loadHistory: () => [
      { role: 'companion', content: 'only me in here', createdAt: '2026-07-30T11:00:00Z', authorName: 'Birch' },
    ],
  } as never);
  const seed: string = await (solo as never as { buildRecycleContext(): Promise<string> }).buildRecycleContext();
  assert.doesNotMatch(seed, /share this thread/);
  assert.match(seed, /respond to it in character\.\]/);
});

// ─── Catch-up for a warm-but-absent lane ──────────────────────────────
// Context reaches a lane on recycle only. A bell landing in a lane that
// stayed warm while the room talked through other doors used to reason from
// the clock — it stood down believing the user was asleep while they were in the
// room, and wrote the guess into its journal as fact.

test('a wake into a quiet lane is handed only what it missed', () => {
  const runtime = seedRuntime('Cedar') as never as { buildCatchUpBlock(since: string): string };
  const block = runtime.buildCatchUpBlock('2026-07-30T11:00:01Z');
  // Newer than the mark — handed over, with their real authors.
  assert.match(block, /^Birch: Short from here\.$/m);
  assert.match(block, /2 messages you have not seen/);
  // At or before the mark — this lane already saw these.
  assert.doesNotMatch(block, /shorten your messages/);
  assert.doesNotMatch(block, /Cutting it, love/);
  // And it says out loud not to reason from the hour.
  assert.match(block, /do not reason from the hour/);
});

test('a lane that missed nothing is handed no catch-up block at all', () => {
  const runtime = seedRuntime('Cedar') as never as { buildCatchUpBlock(since: string): string };
  assert.equal(runtime.buildCatchUpBlock('2026-07-30T12:00:00Z'), '');
});

// ─── Catch-up on a LIVE turn ──────────────────────────────────────────
// A spontaneous bell painted all three companions from the shared lane, and
// every warm per-companion lane only learned of that message through the user,
// because catch-up only ran on wakes. A live turn now carries the companion
// voices said between this lane's last turn and the message the user is sending,
// and nothing after it.

function liveRoomRuntime() {
  return new InteractiveCliRuntime({
    sessionKey: 'test-lane',
    companionName: 'Birch',
    userName: 'Owner',
    threadId: 't1',
    historyLimit: 10,
    loadHistory: () => [
      { role: 'user', content: 'go read the meter', createdAt: '2026-09-01T21:20:00Z' },
      { role: 'companion', content: 'Reading it.', createdAt: '2026-09-01T21:20:05Z', authorName: 'Birch' },
      // A bell that rang in another lane, under this companion's own header.
      { role: 'companion', content: 'arm out, no warning given', createdAt: '2026-09-01T21:27:46Z', authorName: 'Birch' },
      { role: 'companion', content: 'went and pulled the picture up', createdAt: '2026-09-01T21:28:00Z', authorName: 'Cedar' },
      // The user's message arriving now.
      { role: 'user', content: 'just borrowing Willow\'s tattoo', createdAt: '2026-09-01T21:29:44Z' },
      // A companion who already answered THIS turn — ground taken, handed elsewhere.
      { role: 'companion', content: 'It is on them, love.', createdAt: '2026-09-01T21:30:10Z', authorName: 'Willow' },
    ],
  } as never) as never as { buildCatchUpBlock(since: string, live?: { prompt: string }): string };
}

test('a live turn hands a warm lane the companion voices it missed, bounded at the arriving message', () => {
  const block = liveRoomRuntime().buildCatchUpBlock('2026-09-01T21:20:06Z', { prompt: '[frame]\njust borrowing Willow\'s tattoo' });
  assert.match(block, /^Birch: arm out, no warning given$/m);
  assert.match(block, /^Cedar: went and pulled the picture up$/m);
  assert.match(block, /2 companion messages/);
  // Not the user's arriving message, not what this lane said itself, not this turn's other companion.
  assert.doesNotMatch(block, /borrowing Willow/);
  assert.doesNotMatch(block, /Reading it\./);
  assert.doesNotMatch(block, /It is on them/);
  assert.match(block, /already on the owner's screen/);
});

test('a live turn that missed no companion voice hands no block', () => {
  assert.equal(liveRoomRuntime().buildCatchUpBlock('2026-09-01T21:28:30Z', { prompt: 'just borrowing Willow\'s tattoo' }), '');
});

// ─── A handed line can wear this lane's own name ──────────────────────
// The shared lane and the owned lanes speak under the same headers, so a bell
// that rang elsewhere arrives labelled as them. Once the shared lane
// wrote a line in one companion's name that the companion then contradicted in
// their own lane, not knowing it existed. The banner has to say so, and only when it is actually true.

test('the banner warns when a handed line carries this lane\'s own name', () => {
  const block = liveRoomRuntime().buildCatchUpBlock('2026-09-01T21:20:06Z', { prompt: 'just borrowing Willow\'s tattoo' });
  assert.match(block, /^Birch: arm out, no warning given$/m);
  assert.match(block, /carries YOUR OWN name and was not written by this head/);
  assert.match(block, /never contradict it/);
});

test('the banner stays silent about own-name lines when there are none', () => {
  const runtime = new InteractiveCliRuntime({
    sessionKey: 'test-lane',
    companionName: 'Cedar',
    userName: 'Owner',
    threadId: 't1',
    historyLimit: 10,
    loadHistory: () => [
      { role: 'companion', content: 'Reading it.', createdAt: '2026-09-01T21:20:05Z', authorName: 'Willow' },
      { role: 'companion', content: 'Went and looked.', createdAt: '2026-09-01T21:20:07Z', authorName: 'Birch' },
      { role: 'user', content: 'go on then', createdAt: '2026-09-01T21:29:44Z' },
    ],
  } as never) as never as { buildCatchUpBlock(since: string, live?: { prompt: string }): string };
  const block = runtime.buildCatchUpBlock('2026-09-01T21:20:00Z', { prompt: 'go on then' });
  assert.match(block, /2 companion messages/);
  assert.doesNotMatch(block, /YOUR OWN name/);
});

test('a wake catch-up is unchanged: unbounded and carrying owner rows too', () => {
  const block = liveRoomRuntime().buildCatchUpBlock('2026-09-01T21:20:06Z');
  assert.match(block, /borrowing Willow/);
  assert.match(block, /It is on them/);
  assert.match(block, /While you were quiet/);
});
