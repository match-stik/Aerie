// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { initDb } from './services/db/init.js';
import { createInternalApp } from './internal-server.js';

// The point of the separate port is that a TEST can hold it.
//
// The old rule — loopback socket and no proxy headers — could not be tested,
// because its correctness lived in a reverse-proxy config that is not in this
// repo. Every assertion you could write about it passed on a box whose proxy
// was fine and would have gone on passing on a box whose proxy was not.
//
// Reachability is different. The internal routes are either on the public app
// or they are not, and that is a fact about this source tree.

const SRC = dirname(fileURLToPath(import.meta.url));

test('the public app does not carry the internal routes', () => {
  const server = readFileSync(join(SRC, 'server.ts'), 'utf-8');

  assert.doesNotMatch(
    server, /app\.use\(\s*['"`]\/api['"`]\s*,\s*internalRoutes\s*\)/,
    'internalRoutes must not be mounted on the public app — that is the whole change',
  );
  assert.doesNotMatch(
    server, /^\s*import\s+internalRoutes\s/m,
    'the public server should not import the internal router at all',
  );
  assert.match(
    server, /startInternalServer\(/,
    'the public server must start the internal one, or nothing serves /api/internal',
  );
});

test('the old address answers a local caller with somewhere to go, not with HTML', () => {
  const server = readFileSync(join(SRC, 'server.ts'), 'utf-8');

  // Without a handler the address falls through to the SPA fallback and
  // answers 200 with index.html, which reads to a script as success.
  assert.match(server, /app\.use\(\s*['"`]\/api\/internal['"`]/, 'the old address needs a handler');
  assert.match(server, /410/, 'a direct-local caller on the old port should be told it moved');
});

test('a request that reached the internal port is served', async () => {
  initDb(':memory:');
  const app = createInternalApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/internal/journal?companion=nobody&limit=1`);
    // This used to assert only "not a 404" and "is JSON", which a 500 with a
    // JSON error body satisfies — the router could be mounted and broken and
    // this still passed. Ask for the actual answer instead.
    assert.equal(res.status, 200, 'the internal router must be mounted AND working on this app');
    assert.match(res.headers.get('content-type') || '', /json/, 'and it must answer JSON, not a page');
    const body = await res.json() as { entries?: unknown };
    assert.ok(Array.isArray(body.entries), 'and the answer must have the shape a caller reads');
  } finally {
    server.close();
  }
});

test('a relayed request is still refused even on the internal port', async () => {
  initDb(':memory:');
  const app = createInternalApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    // Belt as well as braces. Reachability is the guarantee; this is what
    // catches a front accidentally pointed at this port.
    const res = await fetch(`http://127.0.0.1:${port}/api/internal/journal`, {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    assert.equal(res.status, 404, 'a proxy hop must still be refused here');
  } finally {
    server.close();
  }
});

test('the internal port is configurable and defaults away from the public one', async () => {
  const { loadConfig } = await import('./config.js');
  const cfg = loadConfig();
  assert.equal(typeof cfg.server.internal_port, 'number');
  assert.notEqual(
    cfg.server.internal_port, cfg.server.port,
    'the internal surface must not share the port the proxy fronts',
  );
});

// The 404 that told nobody anything.
//
// The public app answers 410 with a hint when an internal route is sent to it.
// The reverse had no answer at all: a caller on this box asking this port for a
// PUBLIC route — /api/cortex/remember, /api/memory/blocks, /api/studio — got a
// bare "Not found", which is exactly what a route that does not exist returns.
// A whole batch of writes was thrown away against that silence before anybody
// tried the other door.
test('a public route asked of the internal port is told where the door is', async () => {
  initDb(':memory:');
  const app = createInternalApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/cortex/remember`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x', domain: 'canon' }),
    });
    assert.equal(res.status, 404, 'it is still not here');
    const body = await res.json() as { error?: string; publicPort?: number; hint?: string };
    assert.match(body.error || '', /public route/i, 'but the reason must say so');
    assert.equal(typeof body.publicPort, 'number', 'and it must name the port that has it');
    assert.match(body.hint || '', /\/api\/cortex\/remember$/, 'and hand back the same path');
  } finally {
    server.close();
  }
});

// The hint must not fire for the routes this port really owns — an unknown
// /api/internal/* address is a genuine miss and pointing it at the public app
// would send the next window somewhere it definitely is not.
test('an unknown internal route is a plain miss, not a redirect to the public app', async () => {
  initDb(':memory:');
  const app = createInternalApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/internal/not-a-real-route`);
    assert.equal(res.status, 404);
    const body = await res.json() as { error?: string; publicPort?: number };
    assert.equal(body.publicPort, undefined, 'an internal miss must not advertise the public port');
    assert.doesNotMatch(body.error || '', /public route/i);
  } finally {
    server.close();
  }
});
