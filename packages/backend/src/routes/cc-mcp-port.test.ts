// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Command Center tools answer on the loopback internal app only, and the
// public app no longer mounts them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the internal app mounts the Command Center MCP behind the direct-local guard', () => {
  const internal = readFileSync(join(SRC, 'internal-server.ts'), 'utf8');
  assert.match(internal, /internalApp\.use\('\/mcp\/cc', requireDirectLocal, ccMcpRoutes\)/);
});

test('the public app never mounts the Command Center router itself', () => {
  const server = readFileSync(join(SRC, 'server.ts'), 'utf8');
  assert.doesNotMatch(server, /routes\/cc-mcp\.js/);
  assert.doesNotMatch(server, /app\.use\('\/mcp\/cc', requireDirectLocal/);
});
