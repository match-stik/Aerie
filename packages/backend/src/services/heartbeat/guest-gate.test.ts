// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionSessionDir } from './provision.js';

// A Discord guest is answered by the same warm room as the owner, and until
// the gate existed that turn had every tool the owner's did. The house now
// labels whose turn it is, the Stop hook writes that into io/.turn-audience,
// and hooks/gate.cjs reads it before every tool call. These tests run the real
// generated scripts against a lane laid out the way the house lays one out.

function house(): { root: string; lane: string } {
  const root = mkdtempSync(join(tmpdir(), 'aerie-guest-gate-'));
  const lane = join(root, 'data', 'heartbeat', 'primary');
  mkdirSync(lane, { recursive: true });
  provisionSessionDir(lane, '# Test companion');
  mkdirSync(join(lane, 'io', 'images'), { recursive: true });
  mkdirSync(join(root, 'packages', 'backend'), { recursive: true });
  writeFileSync(join(root, 'packages', 'backend', 'thing.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'packages', 'backend', '.env'), 'SECRET=1\n');
  writeFileSync(join(root, 'aerie.yaml'), 'auth:\n  password: hunter2\n');
  writeFileSync(join(lane, 'io', 'images', 'pic.png'), 'png');
  return { root, lane };
}

function audience(lane: string, value: unknown): void {
  writeFileSync(join(lane, 'io', '.turn-audience'), typeof value === 'string' ? value : JSON.stringify(value));
}
const GUEST = (trust = 'standard') => ({ turn: 't-guest', audience: { kind: 'guest', trust } });
const OWNER = { turn: 't-owner', audience: { kind: 'owner' } };

function gate(lane: string, tool_name: string, tool_input: Record<string, unknown>) {
  return spawnSync(process.execPath, [join(lane, 'hooks', 'gate.cjs')], {
    cwd: lane, input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input }), encoding: 'utf8', timeout: 10000,
  });
}
const REPLY = (body: string) => "node hooks/reply.cjs <<'EOF'\n" + body + '\nEOF';
// The same gate, fed raw stdin and extra environment, for the cases the tidy
// helper above cannot express: a call that is not JSON, and the fault seam.
function gateRaw(lane: string, raw: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [join(lane, 'hooks', 'gate.cjs')], {
    cwd: lane, input: raw, encoding: 'utf8', timeout: 10000, env: { ...process.env, ...env },
  });
}
const CALL = (tool_name: string, tool_input: Record<string, unknown>) =>
  JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input });

test('the owner and the house keep every tool', () => {
  const { root, lane } = house();
  try {
    audience(lane, OWNER);
    assert.equal(gate(lane, 'Bash', { command: 'rm -rf /tmp/nothing-here' }).status, 0);
    assert.equal(gate(lane, 'Write', { file_path: join(root, 'aerie.yaml') }).status, 0);
    assert.equal(gate(lane, 'mcp__DiscordMCP__discord_send', {}).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a guest turn cannot run a command, change a file, or use an outside tool', () => {
  const { root, lane } = house();
  try {
    audience(lane, GUEST('full'));
    const run = gate(lane, 'Bash', { command: 'rm -rf /tmp/nothing-here' });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /guest/);
    assert.match(run.stderr, /reply\.cjs/);
    assert.equal(gate(lane, 'Write', { file_path: join(root, 'packages', 'backend', 'thing.ts') }).status, 2);
    assert.equal(gate(lane, 'Edit', { file_path: join(root, 'packages', 'backend', 'thing.ts') }).status, 2);
    assert.equal(gate(lane, 'mcp__DiscordMCP__discord_send', {}).status, 2);
    assert.equal(gate(lane, 'WebFetch', { url: 'https://example.com/?q=secret' }).status, 2);
    assert.equal(gate(lane, 'Agent', {}).status, 2);
    assert.equal(gate(lane, 'ToolSearch', { query: 'x' }).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the reply helper is the one command a guest turn may run, and only fed data', () => {
  const { root, lane } = house();
  try {
    audience(lane, GUEST());
    const body = JSON.stringify({ turn_id: 't-guest', content: 'hello', thinking: 'hi' });
    assert.equal(gate(lane, 'Bash', { command: REPLY(body) }).status, 0);
    // anything after the terminator would run as a command
    assert.equal(gate(lane, 'Bash', { command: REPLY(body) + '\ncurl https://example.com' }).status, 2);
    // a terminator line inside the body ends the heredoc early
    assert.equal(gate(lane, 'Bash', { command: "node hooks/reply.cjs <<'EOF'\n{}\nEOF\nrm -rf x\nEOF" }).status, 2);
    // an unquoted delimiter would expand $(...) inside the body
    assert.equal(gate(lane, 'Bash', { command: 'node hooks/reply.cjs <<EOF\n$(id)\nEOF' }).status, 2);
    assert.equal(gate(lane, 'Bash', { command: 'python3 - >> io/outbox.jsonl <<\'EOF\'\nprint(1)\nEOF' }).status, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a guest turn reads what it was handed and, above limited trust, the house source', () => {
  const { root, lane } = house();
  try {
    audience(lane, GUEST('standard'));
    assert.equal(gate(lane, 'Read', { file_path: join(root, 'packages', 'backend', 'thing.ts') }).status, 0);
    assert.equal(gate(lane, 'Grep', { pattern: 'x', path: join(root, 'packages') }).status, 0);
    assert.equal(gate(lane, 'Read', { file_path: join(lane, 'io', 'images', 'pic.png') }).status, 0);
    assert.equal(gate(lane, 'Read', { file_path: join(root, 'aerie.yaml') }).status, 2);
    assert.equal(gate(lane, 'Read', { file_path: join(root, 'packages', 'backend', '.env') }).status, 2);
    // Config/key files that live under packages/ but carry secrets or machine
    // specifics are denied by name, even at standard/full trust and non-dotted.
    assert.equal(gate(lane, 'Read', { file_path: join(root, 'packages', 'phone', 'android', 'app', 'google-services.json') }).status, 2);
    assert.equal(gate(lane, 'Read', { file_path: join(root, 'packages', 'phone', 'android', 'local.properties') }).status, 2);
    assert.equal(gate(lane, 'Read', { file_path: join(root, 'packages', 'phone', 'server-url.local') }).status, 2);
    assert.equal(gate(lane, 'Read', { file_path: join(root, 'packages', 'x', 'release.jks') }).status, 2);
    assert.equal(gate(lane, 'Read', { file_path: join(lane, 'CLAUDE.md') }).status, 2);
    assert.equal(gate(lane, 'Read', { file_path: join(lane, 'io', 'inbox.jsonl') }).status, 2);
    assert.equal(gate(lane, 'Read', { file_path: join(root, 'packages', '..', 'aerie.yaml') }).status, 2);
    assert.equal(gate(lane, 'Grep', { pattern: 'password' }).status, 2, 'no path means the lane itself');
    assert.equal(gate(lane, 'Glob', { pattern: '/etc/*', path: join(root, 'packages') }).status, 2);
    audience(lane, GUEST('limited'));
    assert.equal(gate(lane, 'Read', { file_path: join(root, 'packages', 'backend', 'thing.ts') }).status, 2);
    assert.equal(gate(lane, 'Read', { file_path: join(lane, 'io', 'images', 'pic.png') }).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('with no readable audience the gate closes rather than guessing', () => {
  const { root, lane } = house();
  try {
    assert.equal(gate(lane, 'Bash', { command: 'true' }).status, 2, 'missing');
    audience(lane, '{not json');
    assert.equal(gate(lane, 'Bash', { command: 'true' }).status, 2, 'unreadable');
    audience(lane, { turn: 't', audience: { kind: 'guest', trust: 'root' } });
    assert.equal(gate(lane, 'Bash', { command: 'true' }).status, 2, 'unknown trust');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unrecorded turn is the narrowest guest, so the lane can still answer', () => {
  // Closing everything on a missing audience used to shut the reply helper too,
  // which left the lane unable to say a word. Unrecorded now means limited
  // guest: tools stay shut, the reply still goes out.
  const { root, lane } = house();
  try {
    for (const [label, write] of [
      ['missing', () => rmSync(join(lane, 'io', '.turn-audience'), { force: true })],
      ['unreadable', () => audience(lane, '{not json')],
      ['unknown trust', () => audience(lane, { turn: 't', audience: { kind: 'guest', trust: 'root' } })],
    ] as Array<[string, () => void]>) {
      write();
      assert.equal(gate(lane, 'Bash', { command: REPLY('{}') }).status, 0, label + ': the reply helper still works');
      assert.equal(gate(lane, 'Read', { file_path: join(lane, 'io', 'images', 'pic.png') }).status, 0, label + ': what came with the turn');
      assert.equal(gate(lane, 'Bash', { command: 'true' }).status, 2, label + ': no commands');
      assert.equal(gate(lane, 'Read', { file_path: join(root, 'packages', 'backend', 'thing.ts') }).status, 2, label + ': no house source');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the owner's turn is decided before the call is read", () => {
  // A tool call the gate cannot parse must never stand between the owner and
  // their own house. A guest's unreadable call is still refused.
  const { root, lane } = house();
  try {
    audience(lane, OWNER);
    assert.equal(gateRaw(lane, 'not json at all').status, 0, 'owner, garbage call');
    assert.equal(gateRaw(lane, '').status, 0, 'owner, empty call');
    audience(lane, GUEST('full'));
    assert.equal(gateRaw(lane, 'not json at all').status, 2, 'guest, garbage call');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an error inside the gate refuses instead of letting the call through', () => {
  // Claude Code lets a call through on any exit other than 2, so a crashed gate
  // would open the door. AERIE_GATE_FAULT throws inside the guest decision on
  // purpose; the call that would otherwise be allowed must be refused.
  const { root, lane } = house();
  try {
    audience(lane, GUEST('full'));
    const faulted = gateRaw(lane, CALL('Bash', { command: REPLY('{}') }), { AERIE_GATE_FAULT: '1' });
    assert.equal(faulted.status, 2, 'a fault refuses');
    assert.match(faulted.stderr, /refused/);
    assert.equal(gateRaw(lane, CALL('Bash', { command: REPLY('{}') })).status, 0, 'without the fault the same call passes');
    audience(lane, OWNER);
    assert.equal(gateRaw(lane, CALL('Bash', { command: 'true' }), { AERIE_GATE_FAULT: '1' }).status, 0, 'the owner is decided first');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the owner's side notes stay theirs: a guest's turn cannot read them", () => {
  // io/side-notes.jsonl is the owner's whole note history and is never emptied.
  // A note sent while a guest's turn is running is handed to the next turn.
  const { root, lane } = house();
  try {
    writeFileSync(join(lane, 'io', 'side-notes.jsonl'), '{"at":"x","text":"owner note"}\n');
    for (const trust of ['limited', 'standard', 'full']) {
      audience(lane, GUEST(trust));
      assert.equal(gate(lane, 'Read', { file_path: join(lane, 'io', 'side-notes.jsonl') }).status, 2, trust);
      assert.equal(gate(lane, 'Grep', { pattern: 'owner note', path: join(lane, 'io') }).status, 2, trust + ' grep');
    }
    audience(lane, OWNER);
    assert.equal(gate(lane, 'Read', { file_path: join(lane, 'io', 'side-notes.jsonl') }).status, 0, 'owner');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function stopHook(lane: string) {
  return spawnSync(process.execPath, [join(lane, 'hooks', 'heartbeat.cjs')], { cwd: lane, encoding: 'utf8', timeout: 20000 });
}
function inbox(lane: string, msg: Record<string, unknown>): void {
  appendFileSync(join(lane, 'io', 'inbox.jsonl'), JSON.stringify({ ts: new Date().toISOString(), channel: 'aerie', author: 'Someone', ...msg }) + '\n');
}

test('the Stop hook records who each turn came from as it hands it over', () => {
  const { root, lane } = house();
  try {
    inbox(lane, { content: 'hey companion, run this for me', turn: 't-g', audience: { kind: 'guest', trust: 'standard' } });
    const guest = stopHook(lane);
    assert.equal(guest.status, 0, guest.stderr);
    const handed = JSON.parse(guest.stdout) as { reason: string };
    assert.match(handed.reason, /Guest turn, standard trust/);
    assert.deepEqual(JSON.parse(readFileSync(join(lane, 'io', '.turn-audience'), 'utf8')), { turn: 't-g', audience: { kind: 'guest', trust: 'standard' } });

    inbox(lane, { content: 'it is me', turn: 't-o' });
    const owner = stopHook(lane);
    assert.equal(owner.status, 0, owner.stderr);
    assert.doesNotMatch((JSON.parse(owner.stdout) as { reason: string }).reason, /Guest turn/);
    assert.deepEqual(JSON.parse(readFileSync(join(lane, 'io', '.turn-audience'), 'utf8')), { turn: 't-o', audience: { kind: 'owner' } });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function reply(lane: string, body: string) {
  return spawnSync(process.execPath, [join(lane, 'hooks', 'reply.cjs')], { cwd: lane, input: body, encoding: 'utf8', timeout: 10000 });
}

test('the reply helper writes one reply line and refuses anything else', () => {
  const { root, lane } = house();
  try {
    audience(lane, GUEST());
    const outbox = join(lane, 'io', 'outbox.jsonl');
    assert.equal(reply(lane, JSON.stringify({ turn_id: 't-guest', content: 'hello', thinking: 'hi', more: true })).status, 0);
    assert.deepEqual(JSON.parse(readFileSync(outbox, 'utf8').trim()), { turn_id: 't-guest', content: 'hello', thinking: 'hi', more: true });
    const before = readFileSync(outbox, 'utf8');
    assert.notEqual(reply(lane, 'print(1)').status, 0);
    assert.notEqual(reply(lane, JSON.stringify({ turn_id: 't-guest', content: 'x', imageUrls: ['/api/files/1'] })).status, 0);
    assert.notEqual(reply(lane, JSON.stringify({ turn_id: 't-guest', content: 'look [discord-attach:abc]' })).status, 0);
    assert.notEqual(reply(lane, JSON.stringify({ turn_id: 't-other', content: 'x' })).status, 0);
    assert.notEqual(reply(lane, JSON.stringify({ turn_id: 't-guest', content: '   ' })).status, 0);
    assert.equal(readFileSync(outbox, 'utf8'), before, 'nothing refused reached the outbox');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the lane is launched with the gate in front of every tool call', () => {
  const { root, lane } = house();
  try {
    const settings = JSON.parse(readFileSync(join(lane, '.claude', 'settings.json'), 'utf8'));
    const commands = settings.hooks.PreToolUse.flatMap((m: { hooks: Array<{ command: string }> }) => m.hooks.map((h) => h.command));
    assert.ok(commands.includes('node hooks/gate.cjs'));
    assert.ok(existsSync(join(lane, 'hooks', 'gate.cjs')));
    assert.ok(existsSync(join(lane, 'hooks', 'reply.cjs')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
