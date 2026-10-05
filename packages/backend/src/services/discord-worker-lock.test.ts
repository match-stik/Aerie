// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The Discord worker's optional lock. Out of the box the worker answers anyone
// who has its address. Setting MCP_SECRET as a worker secret makes every call
// to /mcp or /sse carry it, as a bearer token (what Aerie's API key field sends)
// or as ?key= on the address (for apps that only take a URL). These tests load
// the worker file itself and call its fetch handler directly, so they read the
// same code a Cloudflare deploy runs.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Worker = {
  fetch(request: Request, env: Record<string, string>, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response>;
};

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = resolve(here, '../../../../shared/discord-worker-v4.0.js');

async function loadWorker(): Promise<Worker> {
  const mod = await import(pathToFileURL(workerPath).href);
  return mod.default as Worker;
}

const SECRET = 'open-sesame';
const locked = { MCP_SECRET: SECRET };
const ctx = { waitUntil(_p: Promise<unknown>) {} };

function post(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
}

test('with no secret set, the worker answers the way it always has', async () => {
  const worker = await loadWorker();
  assert.equal((await worker.fetch(post('/mcp'), {}, ctx)).status, 200);
  assert.equal((await worker.fetch(post('/sse'), {}, ctx)).status, 200);
});

test('with a secret set, a call with no key is turned away on both doors', async () => {
  const worker = await loadWorker();
  const mcp = await worker.fetch(post('/mcp'), locked, ctx);
  assert.equal(mcp.status, 401);
  assert.equal(mcp.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await worker.fetch(post('/sse'), locked, ctx)).status, 401);
});

test('a wrong key is turned away, including near misses', async () => {
  const worker = await loadWorker();
  for (const wrong of ['nope', 'open-sesamE', 'open', `${SECRET}x`, '']) {
    const byHeader = await worker.fetch(post('/mcp', { Authorization: `Bearer ${wrong}` }), locked, ctx);
    assert.equal(byHeader.status, 401, `header key ${JSON.stringify(wrong)}`);
    const byAddress = await worker.fetch(post(`/mcp?key=${encodeURIComponent(wrong)}`), locked, ctx);
    assert.equal(byAddress.status, 401, `address key ${JSON.stringify(wrong)}`);
  }
});

test('the right key gets in, as a bearer token or on the address', async () => {
  const worker = await loadWorker();
  const byHeader = await worker.fetch(post('/mcp', { Authorization: `Bearer ${SECRET}` }), locked, ctx);
  assert.equal(byHeader.status, 200);
  const body = await byHeader.json();
  assert.equal(body.result.serverInfo.name, 'aerie-discord');
  assert.equal((await worker.fetch(post(`/mcp?key=${SECRET}`), locked, ctx)).status, 200);
  assert.equal((await worker.fetch(post(`/sse?key=${SECRET}`), locked, ctx)).status, 200);
});

test('a browser preflight still gets through, and is allowed to send the key header', async () => {
  const worker = await loadWorker();
  const res = await worker.fetch(new Request('https://worker.example/mcp', { method: 'OPTIONS' }), locked, ctx);
  assert.equal(res.status, 204);
  assert.match(res.headers.get('Access-Control-Allow-Headers') ?? '', /Authorization/);
});

test('the SSE handshake hands back a message address that still carries the key', async () => {
  // The handshake keeps its stream open with long timers; mocked timers let the
  // test read the first event without leaving five real minutes on the clock.
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    const worker = await loadWorker();
    const res = await worker.fetch(new Request(`https://worker.example/sse?key=${SECRET}`), locked, ctx);
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const event = new TextDecoder().decode(value);
    const endpoint = JSON.parse(event.split('data: ')[1].split('\n')[0]) as string;
    const messageUrl = new URL(endpoint);
    assert.equal(messageUrl.pathname, '/sse');
    assert.ok(messageUrl.searchParams.get('session'));
    assert.equal(messageUrl.searchParams.get('key'), SECRET);
    const follow = await worker.fetch(post(`${messageUrl.pathname}${messageUrl.search}`), locked, ctx);
    assert.equal(follow.status, 200);
    reader.releaseLock();
  } finally {
    // Let the handshake reach its keep-alive timers while they are still the
    // mocked ones. Restored too early, it sets real ones and holds the test
    // process open for the full five minutes.
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    mock.timers.reset();
  }
});
