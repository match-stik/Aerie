// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
const {
  guestRefusal, GUEST_SANDBOX_POLICY, GUEST_APPROVAL_POLICY, GUEST_THREAD_CONFIG, guestThreadConfig,
} = await import('./codex-daemon.js');

// Oct 31 2026: a guest's Discord turn on a Codex model ran with full access
// and every ask approved. Now it runs locked. Proven live the same night on the
// real daemon: a guest turn's touch was refused and the file never appeared,
// its MCP call came back 'user rejected MCP tool call', and with web search and
// the apps switched off it had neither; the same prompt as their turn ran the
// command, made the file and searched the web.

test('every kind of ask is refused in the shape the protocol expects', () => {
  assert.deepEqual(guestRefusal('item/commandExecution/requestApproval'), { result: { decision: 'decline' } });
  assert.deepEqual(guestRefusal('item/fileChange/requestApproval'), { result: { decision: 'decline' } });
  assert.deepEqual(guestRefusal('item/applyPatch/requestApproval'), { result: { decision: 'denied' } });
  assert.deepEqual(guestRefusal('item/execCommand/requestApproval'), { result: { decision: 'denied' } });
  assert.deepEqual(guestRefusal('mcpServer/elicitation/request'), { result: { action: 'decline' } });
  assert.deepEqual(guestRefusal('item/permissions/requestApproval'), { result: { permissions: {}, scope: 'turn' } });
});

test('an ask nobody has seen before is refused, never approved', () => {
  const r = guestRefusal('something/new/requestApproval');
  assert.equal(r.result, undefined);
  assert.ok(r.error);
});

test('a guest room is read-only, asks first, and has no web search or apps', () => {
  assert.deepEqual(GUEST_SANDBOX_POLICY, { type: 'readOnly', networkAccess: false });
  assert.equal(GUEST_APPROVAL_POLICY, 'untrusted');
  assert.equal(GUEST_THREAD_CONFIG.web_search, 'disabled');
  assert.equal(GUEST_THREAD_CONFIG.apps._default.enabled, false);
});

test('the router marks a guest turn and gives it a room apart from theirs', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'agent', 'agent-router-query.ts'), 'utf8');
  assert.match(src, /guest: turnAudience\?\.kind === 'guest'/);
  assert.match(src, /\(turnAudience\?\.kind === 'guest' \? ':guest' : ''\)/);
});

test("a guest's Codex room has no shell to read a file with, and no MCP servers", () => {
  // 'untrusted' auto-runs cat and ls, and read-only limits writes, not reads.
  assert.equal(GUEST_THREAD_CONFIG.features.shell_tool, false);
  assert.equal(GUEST_THREAD_CONFIG.features.unified_exec, false);
  const cfg = guestThreadConfig('model = "x"\n[mcp_servers.spotify]\nurl = "u"\n[mcp_servers."cortex"]\nurl = "c"\n[mcp_servers.spotify.http_headers]\n') as { mcp_servers?: Record<string, { enabled: boolean }>; features: unknown };
  assert.deepEqual(cfg.mcp_servers, { spotify: { enabled: false }, cortex: { enabled: false } });
  assert.deepEqual(cfg.features, { shell_tool: false, unified_exec: false, multi_agent: false, plugins: false, view_image: false });
  assert.equal('mcp_servers' in guestThreadConfig(''), false);
});
