// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// How the password gate on /api is laid out, read off the REAL server.ts and
// router files rather than a replica of them.
//
// apiRoutes (routes/api.ts) owns the public routes — login, health, the file
// links — and gates everything after them with its own router.use(authMiddleware).
// Five admin routers (cortex, discord-admin, orchestrator-admin, xray, media)
// are mounted at the SAME broad '/api' but BEFORE apiRoutes, so apiRoutes' gate
// never covers them; each is gated by a prefix mount instead
// (app.use('/api/cortex', authMiddleware)).
//
// Two ways this has broken, both on 2026-09-30:
//  1. A doubled slash ('/api//cortex/...') missed the prefix gate but still
//     reached the router — every admin endpoint answered anonymously through
//     the public tunnel. Fixed by collapsing duplicate slashes BEFORE any /api
//     mount, so the prefix gates see the normal path.
//  2. The first attempt to fix (1) put router.use(authMiddleware) inside those
//     five routers. A router mounted at the broad '/api' runs that for EVERY
//     /api request that passes through it, so it 401'd the public login and
//     health routes that live in apiRoutes after it. Nobody could sign in.
// These tests hold both shut.

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = readFileSync(join(HERE, '..', 'server.ts'), 'utf8');
const LINES = SERVER.split('\n');

function routerFiles(): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of SERVER.matchAll(/^import\s+(\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+'\.\/routes\/([\w-]+)\.js';/gm)) {
    map.set(m[1], m[2]);
  }
  return map;
}

function broadApiMounts(): string[] {
  const names: string[] = [];
  for (const m of SERVER.matchAll(/^app\.use\('\/api',\s*(\w+)\);/gm)) names.push(m[1]);
  return names;
}

test('no router mounted at /api ahead of apiRoutes gates itself unscoped', () => {
  // An unscoped router.use(authMiddleware) in any of these would 401 the public
  // login, health and file routes that apiRoutes serves after them.
  const files = routerFiles();
  const mounts = broadApiMounts();
  const apiIndex = mounts.indexOf('apiRoutes');
  assert.ok(apiIndex > 0, 'apiRoutes should be mounted at /api after other routers');
  const offenders: string[] = [];
  for (const name of mounts.slice(0, apiIndex)) {
    const file = files.get(name);
    if (!file) continue; // csrfProtection and other non-router middleware
    const src = readFileSync(join(HERE, `${file}.ts`), 'utf8');
    if (/router\.use\(\s*authMiddleware\s*\)/.test(src)) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    `these routers are mounted at /api before apiRoutes and would 401 login/health for everyone: ${offenders.join(', ')}`,
  );
});

test('each admin namespace is gated by a prefix mount', () => {
  for (const prefix of ['/api/cortex', '/api/discord', '/api/orchestrator', '/api/xray', '/api/media']) {
    const re = new RegExp(`^app\\.use\\('${prefix.replace(/\//g, '\\/')}',\\s*authMiddleware\\);`, 'm');
    assert.match(SERVER, re, `${prefix} has lost its authMiddleware prefix mount`);
  }
});

test('duplicate slashes are collapsed before any /api route is reached', () => {
  // The prefix gates only hold if '/api//cortex' has already become '/api/cortex'.
  const collapse = LINES.findIndex((l) => l.includes('collapseDuplicateSlashes(req.url)'));
  const firstApi = LINES.findIndex((l) => /^app\.use\('\/api/.test(l));
  assert.ok(collapse >= 0, 'the slash-collapse middleware is missing from server.ts');
  assert.ok(firstApi >= 0, 'no /api mount found');
  assert.ok(collapse < firstApi, 'the slash-collapse middleware must run before the first /api mount');
});
