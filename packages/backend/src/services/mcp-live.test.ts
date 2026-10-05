// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert';
import {
  classifyCodexMcpStatus,
  codexAppFamilies,
  parseLaneMcpInventory,
  parseMcpList,
  serverNameFromLogDir,
  summarizeLaneMcp,
  summarizeMcpLive,
  mergeBrainRows,
  summarizeSessionMcp,
  summarizeCodexMcpStatus,
  verdictFromLogLines,
  type CodexMcpServerStatus,
} from './mcp-live.js';

// ---------------------------------------------------------------------------
// Codex app-server inventory. One row is one MCP server; codex_apps contains
// app families and must never inflate that server count.
// ---------------------------------------------------------------------------

const codexTool = (name: string, connectorName?: string) => ({
  name,
  inputSchema: { type: 'object' },
  ...(connectorName ? { _meta: { connector_name: connectorName } } : {}),
});

const codexServer = (
  name: string,
  authStatus: CodexMcpServerStatus['authStatus'],
  initialized: boolean,
  tools: CodexMcpServerStatus['tools'] = {},
): CodexMcpServerStatus => ({
  name,
  authStatus,
  serverInfo: initialized ? { name, version: '1.0.0' } : null,
  tools,
  resources: [],
  resourceTemplates: [],
});

const CODEX_ROWS: CodexMcpServerStatus[] = [
  codexServer('spotify', 'unsupported', true, { spotify_play: codexTool('spotify_play') }),
  codexServer('cortex', 'bearerToken', true, { remember: codexTool('remember') }),
  codexServer('openart', 'oAuth', true, { generate: codexTool('generate') }),
  // Tool schemas may exist before login; they do not make the server ready.
  codexServer('gmail', 'notLoggedIn', true, { search: codexTool('search') }),
  codexServer('notion', 'notLoggedIn', false),
  codexServer('constellation-phone', 'unsupported', false),
  codexServer('codex_apps', 'bearerToken', true, {
    'github.get_issue': codexTool('github.get_issue', 'GitHub'),
    'github.create_issue': codexTool('github.create_issue', 'GitHub'),
    'safety_settings.get_family_info': codexTool('safety_settings.get_family_info', 'Safety Settings'),
    'local_group.first': codexTool('local_group.first'),
  }),
];

test('Codex status partitions readiness, sign-in, and failed initialization', () => {
  const state = classifyCodexMcpStatus(CODEX_ROWS);
  assert.deepEqual(state.ready.map(row => row.name), ['spotify', 'cortex', 'openart', 'codex_apps']);
  assert.deepEqual(state.needsAuth.map(row => row.name), ['gmail', 'notion']);
  assert.deepEqual(state.unavailable.map(row => row.name), ['constellation-phone']);
});

test('unsupported auth is not mistaken for a failed MCP server', () => {
  const state = classifyCodexMcpStatus([
    codexServer('plain-http', 'unsupported', true),
  ]);
  assert.deepEqual(state.ready.map(row => row.name), ['plain-http']);
  assert.deepEqual(state.unavailable, []);
});

test('codex_apps is one MCP server with dynamically named connector families', () => {
  const state = classifyCodexMcpStatus(CODEX_ROWS);
  assert.equal(state.ready.filter(row => row.name === 'codex_apps').length, 1);
  assert.deepEqual(state.appFamilies, [
    { key: 'github', name: 'GitHub', toolCount: 2 },
    { key: 'local_group', name: 'Local Group', toolCount: 1 },
    { key: 'safety_settings', name: 'Safety Settings', toolCount: 1 },
  ]);
});

test('nested Codex Apps metadata remains a supported display-name source', () => {
  const apps = codexServer('codex_apps', 'bearerToken', true, {
    'phone.check': {
      name: 'phone.check',
      _meta: { _codex_apps: { connector_name: 'Constellation Phone' } },
    },
  });
  assert.deepEqual(codexAppFamilies(apps), [
    { key: 'phone', name: 'Constellation Phone', toolCount: 1 },
  ]);
});

test('Codex summary counts servers and nests app families beneath Codex Apps', () => {
  const msg = summarizeCodexMcpStatus(CODEX_ROWS);
  assert.match(msg, /^4 MCP servers ready: spotify, cortex, openart, Codex Apps/);
  assert.match(msg, /Needs sign-in: gmail, notion/);
  assert.match(msg, /Did not load: constellation-phone/);
  assert.match(msg, /Codex Apps: 3 app families — GitHub \(2\), Local Group \(1\), Safety Settings \(1\)/);
  // Connector families are not promoted into the MCP-server count.
  assert.ok(!/7 MCP servers ready/.test(msg));
});

test('an empty Codex daemon snapshot is distinct from an all-clear', () => {
  assert.equal(summarizeCodexMcpStatus([]), 'No MCP servers reported by the Codex daemon.');
});

// This parser reads a CLI's HUMAN output — there is no --json. So the format
// is somebody else's to change, and these fixtures are copied verbatim from a
// real run rather than written from the shape I expected.

const REAL = `Checking MCP server health…

claude.ai OpenArt: https://mcp.openart.ai/mcp - ✔ Connected
claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✔ Connected
claude.ai CortexMCP: https://cortex-brain-mcp.example.workers.dev/mcp - ! Needs authentication
SpotifyMCP: https://spotify-mcp.example.workers.dev/mcp (HTTP) - ⏸ Pending approval (run \`claude\` to approve)
`;

test('reads a real run: names with spaces, urls with colons, statuses', () => {
  const rows = parseMcpList(REAL);
  assert.equal(rows.length, 4);

  // A name containing a space and a dot must survive — splitting on the first
  // ': ' is what protects it, because a url's colon has no space after it.
  assert.equal(rows[1].name, 'claude.ai Google Drive');
  assert.equal(rows[1].url, 'https://drivemcp.googleapis.com/mcp/v1');
  assert.equal(rows[1].health, 'connected');

  assert.equal(rows[2].name, 'claude.ai CortexMCP');
  assert.equal(rows[2].health, 'needs-auth');
  assert.equal(rows[2].detail, 'Needs authentication');
});

test('the transport suffix is not part of the url', () => {
  const rows = parseMcpList(REAL);
  assert.equal(rows[3].url, 'https://spotify-mcp.example.workers.dev/mcp');
  assert.equal(rows[3].health, 'pending');
});

test('the health-check header is not a server', () => {
  // It has no ' - ', which is the only reason it is skipped. If the CLI ever
  // prints a header WITH one, this is the test that goes red.
  assert.deepEqual(parseMcpList('Checking MCP server health…'), []);
  assert.deepEqual(parseMcpList(''), []);
});

test('an unrecognised status is kept, not dropped', () => {
  // A server missing from the readout is worse than an ugly line: it would
  // look like it does not exist rather than like we could not classify it.
  const rows = parseMcpList('Weird: https://example.com/mcp - ☂ Raining');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].health, 'unknown');
  assert.equal(rows[0].detail, '☂ Raining');
});

test('the summary names the shut doors and counts the rest', () => {
  const msg = summarizeMcpLive(parseMcpList(REAL));
  assert.match(msg, /2\/4 connected \(live\)/);
  assert.match(msg, /Needs auth: claude\.ai CortexMCP/);
  assert.match(msg, /Pending approval: SpotifyMCP/);
  // The healthy ones are deliberately not listed — the point of waiting nine
  // seconds is learning which one is broken.
  assert.ok(!msg.includes('OpenArt'));
});

test('no servers is said plainly rather than as 0/0', () => {
  assert.equal(summarizeMcpLive([]), 'No MCP servers configured');
});

// ---------------------------------------------------------------------------
// The lane's own inventory. This is the witness that replaced the subcommand:
// `claude mcp list` said 14/19 connected while this window could use 8.
// ---------------------------------------------------------------------------

const DELTA_EARLY = JSON.stringify({
  type: 'attachment',
  attachment: {
    type: 'deferred_tools_delta',
    pendingMcpServers: ['CortexMCP', 'DiscordMCP', 'claude.ai Notion'],
    needsAuthMcpServers: ['claude.ai CortexMCP'],
  },
});
const DELTA_LATE = JSON.stringify({
  type: 'attachment',
  attachment: {
    type: 'deferred_tools_delta',
    pendingMcpServers: [],
    needsAuthMcpServers: ['claude.ai CortexMCP', 'claude.ai Book of Days'],
  },
});

test('the LAST delta is the state, not the first', () => {
  // The early one is mid-startup: it lists servers as pending that arrived
  // seconds later. Reading it would report a healthy lane as half-connected.
  const inv = parseLaneMcpInventory(`${DELTA_EARLY}\n{"type":"user"}\n${DELTA_LATE}\n`);
  assert.deepEqual(inv?.pending, []);
  assert.deepEqual(inv?.needsAuth, ['claude.ai CortexMCP', 'claude.ai Book of Days']);
});

test('a transcript with no delta is null, not an empty all-clear', () => {
  // Null means "no record" and the caller says so. An empty inventory would
  // claim every server is in hand, which is the false all-clear.
  assert.equal(parseLaneMcpInventory('{"type":"user"}\n{"type":"assistant"}\n'), null);
  assert.equal(parseLaneMcpInventory(''), null);
});

test('unparseable lines do not stop the scan', () => {
  const inv = parseLaneMcpInventory(`not json at all\n${DELTA_LATE}\n{oops deferred_tools_delta\n`);
  assert.equal(inv?.needsAuth.length, 2);
});

test('the summary names shut doors and claims nothing it cannot know', () => {
  const msg = summarizeLaneMcp(parseLaneMcpInventory(DELTA_LATE)!);
  assert.match(msg, /Needs sign-in: claude\.ai CortexMCP, claude\.ai Book of Days/);
  // No denominator: the transcript records which servers FAILED, never which
  // loaded, so any "8 of 19" here would be invented.
  assert.ok(!/\d+\/\d+/.test(msg));
});

test('nothing shut is said as a clean sentence', () => {
  assert.equal(
    summarizeLaneMcp({ needsAuth: [], pending: [] }),
    'Every MCP server configured for this lane is in hand.',
  );
});

// ---------------------------------------------------------------------------
// What the window HOLDS, by name. The count of absences was wrong in a way
// that mattered: seven working servers were reported as needing a sign-in
// when this session had simply never attempted them.
// ---------------------------------------------------------------------------

const SID = 'f8c7e9d3-9d0b-47c7-8941-631be82fb338';
const line = (sessionId: string, key: string, text: string) =>
  JSON.stringify({ [key]: text, sessionId });

test('a log directory name becomes the real server name', () => {
  assert.equal(serverNameFromLogDir('mcp-logs-claude-ai-Book-of-Days'), 'claude.ai Book of Days');
  assert.equal(serverNameFromLogDir('mcp-logs-claude-ai-Video-MCP'), 'claude.ai Video MCP');
  assert.equal(serverNameFromLogDir('mcp-logs-DiscordMCP'), 'DiscordMCP');
});

test('connected and failed are read from this session only', () => {
  const other = 'aaaaaaaa-0000-0000-0000-000000000000';
  const jsonl = [
    line(other, 'debug', 'Successfully connected (transport: http) in 12ms'),
    line(SID, 'debug', 'Starting connection with timeout of 30000ms'),
    line(SID, 'debug', 'Successfully connected (transport: http) in 489ms'),
  ].join('\n');
  assert.equal(verdictFromLogLines(jsonl, SID), 'connected');
  // Another window's success must not be borrowed as ours.
  assert.equal(verdictFromLogLines(line(other, 'debug', 'Successfully connected (transport: http) in 12ms'), SID), null);
});

test('a server this session never touched has no verdict at all', () => {
  // This is the whole correction: no line is NOT a shut door. Returning
  // 'failed' here would be the old lie in a new place.
  assert.equal(verdictFromLogLines(line('other-session', 'debug', 'whatever'), SID), null);
  assert.equal(verdictFromLogLines('', SID), null);
});

test('the last verdict wins within a session', () => {
  const jsonl = [
    line(SID, 'debug', 'Connection failed after 565ms: '),
    line(SID, 'debug', 'Successfully connected (transport: http) in 489ms'),
  ].join('\n');
  assert.equal(verdictFromLogLines(jsonl, SID), 'connected');
});

test('the summary leads with what is in hand, named', () => {
  const msg = summarizeSessionMcp([
    { name: 'DiscordMCP', verdict: 'connected' },
    { name: 'claude.ai Notion', verdict: 'connected' },
    { name: 'CortexMCP', verdict: 'failed' },
  ]);
  assert.match(msg, /^2 in hand: DiscordMCP, claude\.ai Notion/);
  assert.match(msg, /Would not open: CortexMCP/);
  // Never the words that made the old readout wrong.
  assert.ok(!/need sign-in/i.test(msg));
});

test('no record is said plainly rather than as an all-clear', () => {
  assert.equal(summarizeSessionMcp([]), 'No MCP servers recorded for this window yet.');
});

// Cortex reaches this house through the backend rather than as an MCP server on
// the lane, so it leaves no line in the CLI's per-server logs. A readout built
// only from those was structurally unable to show it — which defeats the point
// of a screen whose whole job is saying what is connected.
test('the brain is counted as in hand, and says which road it came down', () => {
  const msg = summarizeSessionMcp([
    { name: 'Cortex', verdict: 'connected', via: 'house' },
    { name: 'DiscordMCP', verdict: 'connected' },
  ]);
  assert.match(msg, /^2 in hand: /);
  assert.match(msg, /Cortex \(via the house\)/);
  // It is in the list, not appended as a footnote after it.
  assert.ok(!/\|.*Cortex/.test(msg));
});

test('a brain that will not answer is named as shut, not left out', () => {
  const msg = summarizeSessionMcp([
    { name: 'Cortex', verdict: 'failed', via: 'house' },
    { name: 'DiscordMCP', verdict: 'connected' },
  ]);
  assert.match(msg, /1 in hand: DiscordMCP/);
  assert.match(msg, /Would not open: Cortex \(via the house\)/);
});

// The suffix is the difference between "restart the lane" and "check the
// worker", so it must never leak onto a server that arrived the ordinary way.
test('CLI-road servers carry no suffix', () => {
  const msg = summarizeSessionMcp([{ name: 'DiscordMCP', verdict: 'connected' }]);
  assert.equal(msg, '1 in hand: DiscordMCP');
});

// The two roads genuinely disagree on this lane: the MCP entry points at the
// bare host and fails, the backend reaches the worker fine. Printing both is
// how a readout says a thing is connected and shut in the same breath.
test('a reachable brain replaces the lane MCP row rather than arguing with it', () => {
  const merged = mergeBrainRows(
    [{ name: 'CortexMCP', verdict: 'failed' }, { name: 'DiscordMCP', verdict: 'connected' }],
    { name: 'Cortex', verdict: 'connected', via: 'house' },
  );
  assert.deepEqual(merged.map(s => s.name), ['Cortex', 'DiscordMCP']);
  const msg = summarizeSessionMcp(merged);
  assert.match(msg, /2 in hand/);
  assert.ok(!/Would not open/.test(msg));
});

test('an unreachable brain does not overwrite what the lane said about it', () => {
  const merged = mergeBrainRows(
    [{ name: 'CortexMCP', verdict: 'failed' }],
    { name: 'Cortex', verdict: 'failed', via: 'house' },
  );
  // One failure, not the same failure printed twice under two names.
  assert.deepEqual(merged.map(s => s.name), ['CortexMCP']);
});

test('a brain down with nothing from the lane still gets a row', () => {
  const merged = mergeBrainRows(
    [{ name: 'DiscordMCP', verdict: 'connected' }],
    { name: 'Cortex', verdict: 'failed', via: 'house' },
  );
  assert.match(summarizeSessionMcp(merged), /Would not open: Cortex \(via the house\)/);
});

test('no brain probe leaves the list exactly as the lane reported it', () => {
  const rows: Parameters<typeof mergeBrainRows>[0] = [
    { name: 'CortexMCP', verdict: 'failed' },
    { name: 'DiscordMCP', verdict: 'connected' },
  ];
  assert.deepEqual(mergeBrainRows(rows, null), rows);
});
