// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionSessionDir } from './provision.js';

// The Stop hook is what keeps a warm lane alive: while it blocks, the session
// takes the next message, and if it dies the Stop goes through and the room
// ends. On 2026-09-26 at 05:43Z it died on a tick write, because the
// supervisor had carried off the scratch copy they shared, and the room went
// with it.

function laneWithMessage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aerie-hook-scratch-'));
  provisionSessionDir(dir, '# Test companion');
  mkdirSync(join(dir, 'io'), { recursive: true });
  const msg = { ts: new Date().toISOString(), channel: 'aerie', author: 'Owner', content: 'are you there', turn: 't-1' };
  appendFileSync(join(dir, 'io', 'inbox.jsonl'), JSON.stringify(msg) + '\n');
  return dir;
}

function runHook(dir: string) {
  return spawnSync(process.execPath, [join(dir, 'hooks', 'heartbeat.cjs')], { cwd: dir, encoding: 'utf8', timeout: 20000 });
}

function assertHandedOver(run: ReturnType<typeof runHook>): void {
  assert.strictEqual(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout) as { decision: string; reason: string };
  assert.strictEqual(out.decision, 'block');
  assert.match(out.reason, /are you there/);
}

test('the hook still hands over the owner\'s message when another writer holds the shared scratch name', () => {
  const dir = laneWithMessage();
  try {
    mkdirSync(join(dir, 'io', '.last-tick.tmp'));
    assertHandedOver(runHook(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a tick that cannot be written never ends the room', () => {
  const dir = laneWithMessage();
  try {
    mkdirSync(join(dir, 'io', '.last-tick')); // nothing can be renamed over a directory
    assertHandedOver(runHook(dir));
    const notes = readFileSync(join(dir, 'io', 'hook-exits.jsonl'), 'utf8');
    assert.match(notes, /"reason":"tick-write-failed"/);
    const leftovers = readdirSync(join(dir, 'io')).filter((f) => f.startsWith('.last-tick.') && f.endsWith('.tmp'));
    assert.deepStrictEqual(leftovers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
