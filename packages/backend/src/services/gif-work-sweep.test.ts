// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { sweepGifWork, GIF_WORK_MAX_AGE_MS } from './gif-work-sweep.js';

const DAY = 24 * 60 * 60 * 1000;

function age(path: string, msAgo: number, now: number) {
  const t = new Date(now - msAgo);
  utimesSync(path, t, t);
}

test('a week-old session goes, a fresh one stays, and the uploads folder survives', () => {
  const now = Date.now();
  const dir = mkdtempSync(join(tmpdir(), 'gif-work-'));
  try {
    const old = join(dir, 'old-session');
    mkdirSync(old);
    writeFileSync(join(old, 'frame-0001.png'), 'x');
    age(join(old, 'frame-0001.png'), 8 * DAY, now);
    age(old, 8 * DAY, now);

    const fresh = join(dir, 'fresh-session');
    mkdirSync(fresh);
    writeFileSync(join(fresh, 'frame-0001.png'), 'x');

    const uploads = join(dir, 'uploads');
    mkdirSync(uploads);
    writeFileSync(join(uploads, 'stale'), 'x');
    age(join(uploads, 'stale'), 8 * DAY, now);
    writeFileSync(join(uploads, 'new'), 'x');
    age(uploads, 8 * DAY, now);

    const removed = sweepGifWork(dir, GIF_WORK_MAX_AGE_MS, now).sort();

    assert.deepEqual(removed, ['old-session', join('uploads', 'stale')].sort());
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(fresh), true);
    assert.equal(existsSync(uploads), true, 'multer needs the uploads folder to exist');
    assert.equal(existsSync(join(uploads, 'new')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an old session somebody painted in yesterday is still in use', () => {
  // Painting a frame writes a file inside the folder without touching the
  // folder's own stamp, so the folder alone would read as abandoned.
  const now = Date.now();
  const dir = mkdtempSync(join(tmpdir(), 'gif-work-'));
  try {
    const session = join(dir, 'session');
    mkdirSync(join(session, 'steps'), { recursive: true });
    writeFileSync(join(session, 'frame-0001.png'), 'x');
    age(join(session, 'frame-0001.png'), 30 * DAY, now);
    writeFileSync(join(session, 'steps', 'step-1.png'), 'x');
    age(join(session, 'steps', 'step-1.png'), 1 * DAY, now);
    age(join(session, 'steps'), 30 * DAY, now);
    age(session, 30 * DAY, now);

    assert.deepEqual(sweepGifWork(dir, GIF_WORK_MAX_AGE_MS, now), []);
    assert.equal(existsSync(session), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing work folder is nothing to sweep, not an error', () => {
  assert.deepEqual(sweepGifWork(join(tmpdir(), 'no-such-gif-work-folder-here')), []);
});
