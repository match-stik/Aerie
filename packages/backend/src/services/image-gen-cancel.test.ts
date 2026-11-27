// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Cancelling a Studio picture: a refused picture sat out
// a ten-minute wait while every job behind it waited too. A running job is
// cancelled here against a painter that never finishes, through the real queue.
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'image-gen-cancel-'));
process.env.NODE_ENV = 'test';
process.env.AERIE_STUDIO_JOBS_FILE = join(scratch, 'studio-image-jobs.json');

const { initDb } = await import('./db/init.js');
const { setConfig } = await import('./db/config.js');
const { startGenerateJob, getJobStatus, cancelImageJob } = await import('./image-gen.js');

initDb(':memory:');
test.after(() => rmSync(scratch, { recursive: true, force: true }));

// A painter that hangs, and says when it started.
const pidFile = join(scratch, 'painter.pid');
const fakeCodex = join(scratch, 'codex');
writeFileSync(fakeCodex, `#!/bin/sh\necho $$ > ${pidFile}\nexec sleep 120\n`);
chmodSync(fakeCodex, 0o755);

async function until(fn: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 300; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 20)); }
  assert.fail(`never: ${label}`);
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('a running picture can be cancelled, its painter is killed, and the queue moves on', async () => {
  setConfig('image_gen.enabled', 'true');
  setConfig('image_gen.backend', 'codex');
  setConfig('image_gen.fallback_chain', '');
  setConfig('image_gen.codex_bin', fakeCodex);
  setConfig('image_gen.codex_home', scratch);
  const failures: string[] = [];
  const first = startGenerateJob({ prompt: 'A pumpkin on a porch.', backend: 'codex' }, undefined, (e) => { failures.push(e); });
  const second = startGenerateJob({ prompt: 'Another pumpkin.', backend: 'codex' });
  await until(() => getJobStatus(first)?.status === 'running' && existsSync(pidFile), 'first job running');
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  rmSync(pidFile);

  const out = cancelImageJob(first);
  assert.equal(out.ok, true);
  assert.equal(getJobStatus(first)!.status, 'cancelled');
  await until(() => !alive(pid), 'the painter was killed');
  await until(() => getJobStatus(second)?.status === 'running', 'the next job started');
  assert.deepEqual(failures, ['Cancelled.'], 'a caller keeping its own record hears it');

  // A pending job is skipped when its turn comes; cancel the running one too.
  const third = startGenerateJob({ prompt: 'A third.', backend: 'codex' });
  assert.equal(cancelImageJob(third).ok, true);
  assert.equal(cancelImageJob(second).ok, true);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(getJobStatus(third)!.status, 'cancelled', 'never started');
  assert.equal(existsSync(pidFile) && alive(Number(readFileSync(pidFile, 'utf8'))), false, 'no painter left running');
  assert.equal(cancelImageJob(first).ok, false, 'a finished job cannot be cancelled twice');
});
