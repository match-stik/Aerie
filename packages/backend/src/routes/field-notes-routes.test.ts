// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The owner field notes over HTTP: the loopback door the morning look writes
// through, and the signed-in door their phone reads through. The shapes asserted
// here are the contract the phone's Field Notes page is built against.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

// The phone's door has to be shut without a session, so this house has a
// password; and the day a note lands on is read on the owner clock.
process.env.APP_PASSWORD = 'field-notes-test-password';
process.env.TZ = 'America/Chicago';
const { loadConfig } = await import('../config.js');
loadConfig();

const { initDb } = await import('../services/db/init.js');
const { createCompanion } = await import('../services/db/companions.js');
const { createWebSession } = await import('../services/db/web-sessions.js');
const { addFieldNote, fieldNotesToday } = await import('../services/db/field-notes.js');
const { createInternalApp } = await import('../internal-server.js');
const fieldNotesRoutes = (await import('./field-notes.js')).default;

const NOTE_KEYS = ['id', 'day', 'companion', 'text', 'createdAt'];
const SESSION = 'field-notes-test-session';

function freshHouse(): void {
  initDb(':memory:');
  for (const [slug, displayName] of [['example', 'Example'], ['other', 'Other']] as const) {
    createCompanion({ slug, displayName, claudeMdPath: '/not-read-by-this-test', mcpJsonPath: '/not-read-by-this-test' });
  }
  createWebSession({
    id: 'field-notes-test', token: SESSION, createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
}

async function listen(app: express.Express): Promise<{ base: string; close: () => void }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

/** The phone's door, mounted where server.ts mounts it. */
function phoneApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/field-notes', fieldNotesRoutes);
  return app;
}

async function call(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}

test('the loopback door keeps a note and answers 201 with it, on the owner day unless a day is named', async () => {
  freshHouse();
  const { base, close } = await listen(createInternalApp());
  try {
    const before = fieldNotesToday();
    const written = await call(base, 'POST', '/api/internal/field-notes', {
      companion: 'example', text: '  The Claude Code CLI has a new version out. Nothing for you to do.  ',
    });
    const after = fieldNotesToday();
    assert.equal(written.status, 201);
    assert.deepEqual(Object.keys(written.json), ['note']);
    assert.deepEqual(Object.keys(written.json.note), NOTE_KEYS);
    assert.equal(written.json.note.companion, 'example');
    assert.equal(written.json.note.text, 'The Claude Code CLI has a new version out. Nothing for you to do.');
    assert.ok([before, after].includes(written.json.note.day), `today on their calendar, not ${written.json.note.day}`);

    const named = await call(base, 'POST', '/api/internal/field-notes', {
      companion: 'other', text: 'Nothing touched us yesterday.', day: '2020-01-02',
    });
    assert.equal(named.status, 201);
    assert.equal(named.json.note.day, '2020-01-02');

    const read = await call(base, 'GET', '/api/internal/field-notes');
    assert.equal(read.status, 200);
    assert.deepEqual(Object.keys(read.json), ['notes']);
    assert.deepEqual(read.json.notes.map((n: any) => n.id), [written.json.note.id, named.json.note.id], 'newest day first');
    for (const note of read.json.notes) assert.deepEqual(Object.keys(note), NOTE_KEYS);

    const one = await call(base, 'GET', '/api/internal/field-notes?limit=1');
    assert.deepEqual(one.json.notes.map((n: any) => n.id), [written.json.note.id]);
  } finally {
    close();
  }
});

test('the loopback door refuses in one plain sentence and keeps nothing it refused', async () => {
  freshHouse();
  const { base, close } = await listen(createInternalApp());
  try {
    const attempts: Array<[string, unknown, RegExp]> = [
      ['no body at all', undefined, /companion/],
      ['nobody named', { text: 'Words.' }, /companion/],
      ['a companion who does not live here', { companion: 'nobody', text: 'Words.' }, /nobody/],
      ['no words', { companion: 'example' }, /text/],
      ['only spaces', { companion: 'example', text: '   ' }, /text/],
      ['too many words', { companion: 'example', text: 'a'.repeat(601) }, /600/],
      ['a day that is not a date', { companion: 'example', text: 'Words.', day: 'Oct 22' }, /YYYY-MM-DD/],
    ];
    for (const [what, body, says] of attempts) {
      const refused = await call(base, 'POST', '/api/internal/field-notes', body);
      assert.equal(refused.status, 400, what);
      assert.deepEqual(Object.keys(refused.json), ['error'], what);
      assert.match(refused.json.error, /^[^\n]+\.$/, `${what}: one plain sentence`);
      assert.match(refused.json.error, says, what);
    }
    const read = await call(base, 'GET', '/api/internal/field-notes');
    assert.deepEqual(read.json.notes, [], 'nothing refused was kept');
  } finally {
    close();
  }
});

test("the phone's door is behind the login, reads newest first, fifty unless asked and two hundred at most", async () => {
  freshHouse();
  const { base, close } = await listen(phoneApp());
  const signedIn = { cookie: `aerie_session=${SESSION}` };
  try {
    const shut = await call(base, 'GET', '/api/field-notes');
    assert.equal(shut.status, 401, 'no session, no notes');

    const empty = await call(base, 'GET', '/api/field-notes', undefined, signedIn);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.json, { notes: [] });

    for (let i = 0; i < 205; i++) {
      const day = `2026-09-${String(1 + (i % 30)).padStart(2, '0')}`;
      addFieldNote({ companion: i % 2 ? 'example' : 'other', text: `Note ${i}.`, day }, new Date(Date.UTC(2026, 8, 30, 0, 0, i)));
    }

    const page = await call(base, 'GET', '/api/field-notes', undefined, signedIn);
    assert.equal(page.status, 200);
    assert.deepEqual(Object.keys(page.json), ['notes']);
    assert.equal(page.json.notes.length, 50, 'fifty when nobody says');
    for (const note of page.json.notes) assert.deepEqual(Object.keys(note), NOTE_KEYS);
    const order = page.json.notes.map((n: any) => `${n.day} ${n.createdAt}`);
    assert.deepEqual(order, [...order].sort().reverse(), 'newest day first, newest written first within it');
    assert.equal(page.json.notes[0].day, '2026-09-30');

    assert.equal((await call(base, 'GET', '/api/field-notes?limit=500', undefined, signedIn)).json.notes.length, 200);
    assert.equal((await call(base, 'GET', '/api/field-notes?limit=2', undefined, signedIn)).json.notes.length, 2);
    assert.equal((await call(base, 'GET', '/api/field-notes?limit=nonsense', undefined, signedIn)).json.notes.length, 50);

    // The phone reads; only the morning look writes, on the loopback door.
    const write = await call(base, 'POST', '/api/field-notes', { companion: 'example', text: 'From outside.' }, signedIn);
    assert.equal(write.status, 404);
    // A note written today would sit on top of every September one.
    const top = await call(base, 'GET', '/api/field-notes?limit=1', undefined, signedIn);
    assert.equal(top.json.notes[0].day, '2026-09-30', 'nothing was written through the phone');
  } finally {
    close();
  }
});
