// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The door for saying something in a Discord room on our own: it checks what
// it is handed, sends through the house's Discord service so the message is
// kept at home, and answers with the service's own refusal when there is one.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'net';
import router from './discord-say.js';
import { SayError } from '../../services/discord/say-error.js';

async function door(service: unknown): Promise<{ post: (body: unknown) => Promise<{ status: number; body: any }>; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.locals.discordService = service;
  app.use('/api', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  return {
    post: async (body) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/internal/discord/say`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    },
    close: () => server.close(),
  };
}

test('it sends through the house and hands back where it was kept', async () => {
  const calls: Array<[string, string]> = [];
  const d = await door({ sayInChannel: async (c: string, t: string) => { calls.push([c, t]); return { threadId: 'th', messageId: 'm', sentIds: ['1'] }; } });
  try {
    const r = await d.post({ channelId: '123456789012345678', content: '  hello there  ' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { threadId: 'th', messageId: 'm', sentIds: ['1'] });
    assert.deepEqual(calls, [['123456789012345678', 'hello there']]);
  } finally { d.close(); }
});

test('it refuses what it cannot check, and passes on the service refusal', async () => {
  const d = await door({ sayInChannel: async () => { throw new SayError(403, 'That DM is with somebody they have not let in.'); } });
  try {
    assert.equal((await d.post({ channelId: 'general', content: 'x' })).status, 400);
    assert.equal((await d.post({ channelId: '123456789', content: '   ' })).status, 400);
    assert.equal((await d.post({ channelId: '123456789', content: 'x'.repeat(8001) })).status, 400);
    const refused = await d.post({ channelId: '123456789', content: 'hi' });
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /not let in/);
  } finally { d.close(); }
});

test('with no Discord running it says so instead of pretending', async () => {
  const d = await door(null);
  try { assert.equal((await d.post({ channelId: '123456789', content: 'hi' })).status, 503); } finally { d.close(); }
});
