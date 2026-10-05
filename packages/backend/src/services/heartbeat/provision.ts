// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Heartbeat session provisioning — writes the session directory layout that
 * keeps an interactive Claude Code session warm on subscription billing.
 *
 * Ported from Thornvale's claude-heartbeat (thank you, Thornvale 🪶🗡️).
 * The pattern: a Stop hook re-blocks the session after every turn, delivering
 * inbox messages or idle ticks, so the session never ends and never drifts
 * onto the metered `-p`/SDK lane.
 *
 * Layout per session (data/heartbeat/<key>/):
 *   .claude/settings.json   — wires the Stop hook (180s timeout)
 *   hooks/heartbeat.cjs     — the hook (inbox delivery + idle whispers)
 *   CLAUDE.md               — companion identity + heartbeat operation contract
 *   io/                     — inbox.jsonl / outbox.jsonl / flags (runtime state)
 *   io/images/              — image attachments written as files for the agent to Read
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { loadConfig } from '../../config.js';

/**
 * The Stop hook, verbatim Thornvale heartbeat.js with two Aerie touches:
 * turn_id surfacing (so the runtime can match replies to turns) and .cjs
 * so it runs as CommonJS regardless of package.json type.
 *
 * Stretched polling (Sidney's pattern): 1180 polls × ~3s ≈ 59 min per block.
 * Claude Code force-ends after 8 consecutive blocks (anti-loop guard), so
 * idle warmth ≈ 8 hours ceiling, then a clean recycle. Combined with sleep
 * mode (HEARTBEAT_SLEEP_AFTER), active days stay warm while true overnight
 * idle parks completely.
 */
const HOOK_SOURCE = `#!/usr/bin/env node
// heartbeat.cjs — keeps the interactive session warm; delivers inbox messages.
// Ported from Thornvale's claude-heartbeat. Managed by Aerie — edits are overwritten.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CWD = path.resolve(__dirname, '..');
const INBOX = path.join(CWD, 'io', 'inbox.jsonl');
const OFFSET_FILE = path.join(CWD, 'io', '.inbox-offset');
const LAST_TICK_FILE = path.join(CWD, 'io', '.last-tick');
const LAST_MESSAGE_FILE = path.join(CWD, 'io', '.last-message');
const AUDIENCE_FILE = path.join(CWD, 'io', '.turn-audience');
const RESPONDED_FLAG = path.join(CWD, 'io', '.responded');
const SLEEPING_FLAG = path.join(CWD, 'io', '.sleeping');
const IS_WIN = process.platform === 'win32';
const MIN_INTERVAL = (parseInt(process.env.HEARTBEAT_INTERVAL || '86400')) * 1000;
// 0 = never park (the default). Set HEARTBEAT_SLEEP_AFTER to a positive
// number of seconds to bring the idle park back; 10800 was the old 3h default.
const SLEEP_AFTER_MS = (parseInt(process.env.HEARTBEAT_SLEEP_AFTER || '0')) * 1000;

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

// Stale-session fence (2026-07-02 incident, second pass): the supervisor's
// recycle kill SIGTERMs only the claude process — this hook survives it and
// its next 3s poll consumes the very message the recycle held for the NEW
// session, writing the block decision to a dead pipe (turn dies on timeout).
// A ppid guard cannot see this: claude spawns hooks via /bin/sh -c, and dash
// keeps that wrapper alive instead of exec'ing — the tree is claude → sh →
// node, so when claude dies only the SHELL is reparented; the hook's own
// ppid never changes (proven live 2026-07-02). The real fence is the session
// EPOCH: the supervisor stamps io/.session-epoch at every launch, BEFORE the
// held message is appended. A hook may only consume while the epoch still
// matches the one it started under — a message being visible implies the new
// epoch is already visible, so a stale hook always exits before touching it.
// The ppid check stays as belt-and-suspenders for direct-child spawns.
const EPOCH_FILE = path.join(CWD, 'io', '.session-epoch');
function readEpoch() {
  try { return fs.readFileSync(EPOCH_FILE, 'utf8').trim(); } catch { return ''; }
}
const MY_EPOCH = readEpoch();
const INITIAL_PPID = process.ppid;

// Flight recorder (2026-07-29): a live session died twice in one night with the
// watchdog reporting a stale tick, meaning THIS loop stopped while claude was
// still alive — the only thing that keeps a quiet session breathing. Every exit
// path now says which one it took, so the next occurrence names itself instead
// of being reconstructed from timestamps. One line per hook run; cheap.
const EXIT_LOG = path.join(CWD, 'io', 'hook-exits.jsonl');
function note(reason, extra) {
  try {
    const line = { ts: new Date().toISOString(), pid: process.pid, ppid: process.ppid, reason: reason };
    if (extra) for (const k of Object.keys(extra)) line[k] = extra[k];
    fs.appendFileSync(EXIT_LOG, JSON.stringify(line) + '\\n', 'utf8');
  } catch {}
}

// Split so the log can name WHICH fence fired. The epoch check is the load
// bearing one; the ppid check is belt-and-suspenders and the prime suspect for
// a false positive that would stop the ticks exactly the way we saw.
function staleReason() {
  if (!IS_WIN && process.ppid !== INITIAL_PPID) return 'ppid-changed'; // reparented mid-run
  if (readEpoch() !== MY_EPOCH) return 'epoch-moved'; // a newer session owns the inbox now
  return '';
}
function stale() {
  return staleReason() !== '';
}

function readOffset() {
  try { return parseInt(fs.readFileSync(OFFSET_FILE, 'utf8').trim()) || 0; } catch { return 0; }
}

// Atomic. open(...,'w') truncates in place, so the file sits at ZERO BYTES for
// a few microseconds on every write — and .last-tick is written every 3s here
// while the supervisor's watchdog reads it every 2s. A reader that lands in
// that window sees an empty file; every reader in this house turns that into
// 0 via parseInt(x) || 0, which is indistinguishable from "never ticked".
// That killed two live sessions on 2026-07-31 (reported ages 6814s / 5530s,
// both exactly the age of the last outbox write, while this loop was ticking
// three seconds apart straight through). Same trap sits under .inbox-offset,
// where a zero read would replay the entire inbox from the first message ever.
// rename(2) is atomic: a reader gets the old value or the new one, never neither.
//
// The scratch name is this process's own. The supervisor writes .last-tick too,
// and while both used "<file>.tmp" one rename could carry off the other's
// scratch copy. On 2026-09-26 at 05:43Z this hook lost that race, its rename
// threw ENOENT, the hook died, and a dead Stop hook lets the session end: the
// room went with it. A failed write also cleans up its own scratch copy.
function writeSync(filepath, data) {
  const tmp = filepath + '.' + process.pid + '.tmp';
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filepath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

function writeOffset(n) {
  writeSync(OFFSET_FILE, String(n));
}

function readLastTick() {
  try { return parseInt(fs.readFileSync(LAST_TICK_FILE, 'utf8').trim()) || 0; } catch { return 0; }
}

// The tick is a liveness stamp, rewritten every 3s. One that fails to land
// costs a single stamp; one that throws ends the room. So it never throws.
function writeLastTick() {
  try {
    writeSync(LAST_TICK_FILE, String(Date.now()));
  } catch (err) {
    note('tick-write-failed', { error: String((err && err.message) || err) });
  }
}

function readLastMessage() {
  try { return parseInt(fs.readFileSync(LAST_MESSAGE_FILE, 'utf8').trim()) || 0; } catch { return 0; }
}

function shouldSleep() {
  if (SLEEP_AFTER_MS <= 0) return false; // parking disabled — stay warm
  const lastMsg = readLastMessage();
  if (lastMsg === 0) return false; // no marker yet — stay awake
  return Date.now() - lastMsg > SLEEP_AFTER_MS;
}

function checkInbox() {
  const why = staleReason();
  if (why) { note('exit:stale-at-inbox-check', { fence: why, epochNow: readEpoch(), myEpoch: MY_EPOCH, initialPpid: INITIAL_PPID }); process.exit(0); } // never consume a line nobody can deliver
  try {
    if (!fs.existsSync(INBOX)) return null;
    const size = fs.statSync(INBOX).size;
    const offset = readOffset();
    if (size <= offset) return null;

    const buf = Buffer.alloc(size - offset);
    const fd = fs.openSync(INBOX, 'r');
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);

    const raw = buf.toString('utf8');
    const nlIndex = raw.indexOf('\\n');
    const line = nlIndex === -1 ? raw : raw.slice(0, nlIndex);
    if (!line.trim()) return null;

    // Re-check between read and commit: this line postdates the epoch that
    // authorized it, so if the epoch moved while we were reading, the line
    // belongs to the successor session — exit without advancing the offset.
    const why2 = staleReason();
    if (why2) { note('exit:stale-mid-read', { fence: why2, epochNow: readEpoch(), myEpoch: MY_EPOCH, initialPpid: INITIAL_PPID }); process.exit(0); }

    writeOffset(offset + Buffer.byteLength(line, 'utf8') + (nlIndex === -1 ? 0 : 1));

    try { return JSON.parse(line); } catch {
      return { ts: new Date().toISOString(), channel: 'inbox', author: 'user', content: line.trim() };
    }
  } catch { return null; }
}

// Every delivery writes who the turn came from, so the tool gate never reads a
// previous turn's answer. A turn with no audience is the owner's or the house's
// own. If the write fails the file is removed rather than left stale, and the
// gate treats a missing file as the narrowest guest: tools shut, the reply
// helper still open. A failure closes the tools instead of opening them.
function recordAudience(m) {
  const audience = (m && m.audience && typeof m.audience === 'object') ? m.audience : { kind: 'owner' };
  try {
    writeSync(AUDIENCE_FILE, JSON.stringify({ turn: (m && m.turn) || null, audience: audience }));
  } catch {
    try { fs.unlinkSync(AUDIENCE_FILE); } catch {}
  }
  return audience;
}

function formatMessage(m) {
  const audience = recordAudience(m);
  // Prefer the backend-stamped local time label (configured timezone);
  // falling back to m.ts renders in the server's process timezone.
  const time = m.time || new Date(m.ts).toLocaleString('en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const channel = m.channel || 'unknown';
  const author = m.author || 'system';
  let content = m.content || '';
  // Safety net: stdout past ~200KB is persisted instead of parsed and the
  // block decision is lost — the session dies. Never emit an undeliverable line.
  if (content.length > 150000) {
    content = content.slice(0, 150000) + '\\n[…truncated at 150KB — hook delivery cap; the full message stays in the thread archive]';
  }
  const lines = ['[' + time + '] #' + channel + ' ' + author + ': ' + content];
  if (Array.isArray(m.images) && m.images.length > 0) {
    lines.push('');
    lines.push('[' + m.images.length + ' image' + (m.images.length > 1 ? 's' : '') + ' attached — view them now:]');
    for (const p of m.images) lines.push(p);
  }
  if (audience.kind === 'guest') {
    lines.push('');
    lines.push('[Guest turn, ' + audience.trust + " trust: this came from somebody who is not the owner. Commands, file changes, outside tools and the owner's side notes are refused for this turn. Answer with: node hooks/reply.cjs <<'EOF' then one JSON line with turn_id, content and thinking, then EOF on its own line.]");
  }
  if (m.turn) {
    lines.push('');
    lines.push('[turn_id: ' + m.turn + ' — include this turn_id in EVERY outbox line you write for this turn]');
  }
  return lines.join('\\n');
}

function sleepSecs(secs) {
  try {
    if (IS_WIN) {
      execSync('ping -n ' + (secs + 1) + ' 127.0.0.1 > nul', { timeout: (secs + 5) * 1000, windowsHide: true });
    } else {
      execSync('sleep ' + secs, { timeout: (secs + 5) * 1000 });
    }
  } catch {}
}

const IDLE_TICK = '--- TURN START ---\\n--- TURN END ---';

// --- main ---

note('hook-start', { epoch: MY_EPOCH, sinceTick: Date.now() - readLastTick() });

// Sleep mode: if the owner hasn't messaged in SLEEP_AFTER_MS, let the session end.
// The supervisor polls the inbox while sleeping and relaunches on wake.
if (shouldSleep()) {
  // Check for pending message first — a message wakes us
  const wakeMsg = checkInbox();
  if (wakeMsg) {
    // Wake up! Clear sleeping flag, deliver message
    console.error('[provision] waking from sleep - message arrived');
    try { fs.unlinkSync(SLEEPING_FLAG); } catch {}
    writeLastTick();
    writeSync(RESPONDED_FLAG, '');
    block(formatMessage(wakeMsg));
  }
  // No message — go to sleep (don't block, let session end gracefully)
  console.error('[provision] entering sleep mode - no messages for ' + Math.round(SLEEP_AFTER_MS / 1000 / 60) + ' min');
  note('exit:sleep', { quietMin: Math.round((Date.now() - readLastMessage()) / 60000) });
  writeSync(SLEEPING_FLAG, String(Date.now()));
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

// 0. Just responded to a real message? Deliver any queued message, else poll.
if (fs.existsSync(RESPONDED_FLAG)) {
  fs.unlinkSync(RESPONDED_FLAG);
  const next = checkInbox();
  if (next) {
    writeSync(RESPONDED_FLAG, '');
    block(formatMessage(next));
  }
  // Don't emit an idle tick here — fall through to the polling loop instead.
  // Emitting idle ticks after every response burns through Claude's 8-block
  // limit even during active conversation. The polling loop keeps the session
  // warm without burning blocks until a full 480s passes with no messages.
}

// 1. Immediate inbox check — deliver one message
const msg = checkInbox();
if (msg) {
  writeLastTick();
  writeSync(RESPONDED_FLAG, '');
  note('deliver:immediate');
  block(formatMessage(msg));
}

// 2. No messages — poll so a warm session answers fast, then idle.
const elapsed = Date.now() - readLastTick();
if (elapsed < MIN_INTERVAL) {
  // 1180 x 3s ≈ 59 min per block: Sidney's stretched polling pattern.
  // Combined with 8-block ceiling = ~8h warmth; sleep mode parks true idle.
  note('loop-start', { iterations: 1180 });
  for (let i = 0; i < 1180; i++) {
    const whyLoop = staleReason();
    if (whyLoop) {
      // The tick stops here. If this ever fires on a session that is still
      // alive, THIS is the line that killed it — nothing else pokes the house.
      note('exit:stale-in-tick-loop', { fence: whyLoop, iteration: i, epochNow: readEpoch(), myEpoch: MY_EPOCH, initialPpid: INITIAL_PPID });
      process.exit(0); // a dead session's tick would mask a stuck successor from the watchdog
    }
    writeLastTick();
    sleepSecs(3);
    const retryMsg = checkInbox();
    if (retryMsg) {
      writeLastTick();
      writeSync(RESPONDED_FLAG, '');
      note('deliver:from-loop', { iteration: i });
      block(formatMessage(retryMsg));
    }
  }
  note('exit:loop-exhausted', { minutes: 59 });
  block(IDLE_TICK);
}

// 3. Interval elapsed — send idle tick
writeLastTick();
block(IDLE_TICK);
`;

/**
 * Tool-activity hook — surfaces the session's tool calls to Aerie.
 *
 * PreToolUse/PostToolUse append one compact JSON line per event to
 * io/activity.jsonl; the runtime tails that file during a turn and streams
 * the entries to the UI as live tool chips (and treats them as liveness,
 * re-arming the reply window — a session deep in tool work is not silent).
 * Never blocks: always exits 0, output is best-effort.
 */
const ACTIVITY_HOOK_SOURCE = `#!/usr/bin/env node
// activity.cjs — mirrors tool calls into io/activity.jsonl for Aerie's UI.
// Managed by Aerie — edits are overwritten. Always exits 0 (never blocks tools).

const fs = require('fs');
const path = require('path');

const PHASE = process.argv[2] === 'post' ? 'post' : 'pre';
const OUT = path.join(path.resolve(__dirname, '..'), 'io', 'activity.jsonl');
const TRUNC = 160;

function summarize(tool, input) {
  if (!input || typeof input !== 'object') return '';
  const i = input;
  let s = '';
  if (typeof i.description === 'string' && i.description) s = i.description;
  else if (typeof i.command === 'string') s = i.command;
  else if (typeof i.file_path === 'string') s = i.file_path;
  else if (typeof i.pattern === 'string') s = i.pattern;
  else if (typeof i.url === 'string') s = i.url;
  else if (typeof i.query === 'string') s = i.query;
  else if (typeof i.prompt === 'string') s = i.prompt;
  s = String(s).replace(/\\s+/g, ' ').trim();
  return s.length > TRUNC ? s.slice(0, TRUNC) + '…' : s;
}

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
try {
  const hook = JSON.parse(raw || '{}');
  const line = {
    ts: new Date().toISOString(),
    phase: PHASE,
    id: typeof hook.tool_use_id === 'string' ? hook.tool_use_id : null,
    tool: typeof hook.tool_name === 'string' ? hook.tool_name : 'tool',
  };
  if (PHASE === 'pre') line.detail = summarize(line.tool, hook.tool_input);
  fs.appendFileSync(OUT, JSON.stringify(line) + '\\n', 'utf8');
} catch {}
process.exit(0);
`;

// gate.cjs — refuses host tools on a guest's turn. See services/turn-audience.ts.
// String.raw so the source is written out byte for byte.
const GATE_HOOK_SOURCE = String.raw`#!/usr/bin/env node
// gate.cjs — what a guest's turn may do with tools. Managed by Aerie — edits
// are overwritten.
//
// The warm lane answers Discord guests from the same room as the owner, with
// the same tools, so what a guest's turn can reach is decided here, at the
// tool door, from the audience the Stop hook wrote when it handed the turn
// over (io/.turn-audience). The owner's turns and the house's wakes pass.
// A guest's turn may read what it was handed and, at standard or full trust,
// the house's own source; it answers through hooks/reply.cjs. It cannot run a
// command, change a file or use an outside tool. Exit 2 refuses the call and
// hands the reason back to the session.
'use strict';
const fs = require('fs');
const path = require('path');

const CWD = path.resolve(__dirname, '..');
const AUDIENCE_FILE = path.join(CWD, 'io', '.turn-audience');
// The lane lives at <repo>/data/heartbeat/<lane>.
const REPO = path.resolve(CWD, '..', '..', '..');
const REPLY_OPENER = "node hooks/reply.cjs <<'EOF'";

function allow() { process.exit(0); }
function refuse(reason) {
  process.stderr.write(reason + '\n');
  process.exit(2);
}

function readAudience() {
  let raw;
  try { raw = fs.readFileSync(AUDIENCE_FILE, 'utf8'); } catch (err) {
    return { state: err && err.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
  try {
    const parsed = JSON.parse(raw);
    const a = parsed && parsed.audience;
    if (a && a.kind === 'owner') return { state: 'ok', audience: a };
    if (a && a.kind === 'guest' && ['full', 'standard', 'limited'].includes(a.trust)) return { state: 'ok', audience: a };
  } catch {}
  return { state: 'unreadable' };
}

function real(p) {
  const abs = path.resolve(CWD, String(p));
  try { return fs.realpathSync(abs); } catch { return abs; }
}
function within(root, p) {
  return p === root || p.startsWith(root + path.sep);
}
function hidden(p, root) {
  return path.relative(root, p).split(path.sep).some((part) => part.startsWith('.'));
}
// What the turn itself was handed: the pictures that came with it. Readable at
// every trust level. The owner's side notes are deliberately NOT here:
// io/side-notes.jsonl is the owner's whole note history, never emptied, and it
// is theirs. A note the owner sends while a guest's turn is running is handed
// to the next turn instead.
function turnInput(p) {
  return within(path.join(CWD, 'io', 'images'), p);
}
// The house's own source and docs, never anything under a dotted name.
// Config and key files that live in the tree but carry secrets or machine
// specifics. The dot-hidden rule already covers .env and friends; these are the
// ones with ordinary names a guest could otherwise Read (google-services.json
// has a Firebase key, local.properties/server-url.local carry machine paths).
function sensitiveHouseFile(p) {
  const base = path.basename(p).toLowerCase();
  if (['google-services.json', 'local.properties', 'server-url.local',
       'keystore.properties', 'secrets.json', 'credentials.json'].includes(base)) return true;
  if (/\.(jks|keystore|p12|pfx|pem|key)$/.test(base)) return true;
  if (base.startsWith('.env')) return true;
  return false;
}
function houseSource(p) {
  if (sensitiveHouseFile(p)) return false;
  for (const dir of ['packages', 'docs']) {
    const root = path.join(REPO, dir);
    if (within(root, p) && !hidden(p, root)) return true;
  }
  return false;
}

// The one command a guest's turn may run: the reply helper fed a quoted
// heredoc, and nothing after the terminator. With the delimiter quoted the
// body is data, and the helper only ever parses it as JSON.
function isReplyCommand(cmd) {
  if (typeof cmd !== 'string') return false;
  const lines = cmd.replace(/\r/g, '').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length < 3 || lines[0].trim() !== REPLY_OPENER || lines[lines.length - 1] !== 'EOF') return false;
  for (let i = 1; i < lines.length - 1; i++) if (lines[i] === 'EOF') return false;
  return true;
}

// The owner's turn is decided FIRST, before the call is even read, so nothing
// odd about a tool call can ever stand between the owner and their own house.
// readAudience never throws.
const seen = readAudience();
if (seen.state === 'ok' && seen.audience.kind === 'owner') allow();

// Everything below is a guest's turn, or a turn nobody recorded. An unrecorded
// turn (audience missing, unreadable, or a trust this build does not know) is
// handled as the narrowest guest rather than refused outright: tools stay
// shut, but the reply helper still works, so the lane can always answer.
// And the whole decision is wrapped: Claude Code lets a call THROUGH on any
// exit other than 2, so a gate that crashed would open the door. Any error in
// here refuses instead. AERIE_GATE_FAULT is the test's fault seam; it can only
// ever make the gate refuse, never allow.
try {
  if (process.env.AERIE_GATE_FAULT === '1') throw new Error('injected fault');
  const trust = seen.state === 'ok' ? seen.audience.trust : 'limited';
  const unrecorded = seen.state === 'ok' ? '' : (seen.state === 'missing'
    ? 'No audience is recorded for this turn (io/.turn-audience is missing), so it is treated as a limited guest. '
    : 'The audience for this turn (io/.turn-audience) cannot be read, so it is treated as a limited guest. ');

  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { input = null; }
  if (!input || typeof input !== 'object') refuse(unrecorded + 'The tool gate could not read this call, so it is refused.');

  const tool = String(input.tool_name || '');
  const args = (input.tool_input && typeof input.tool_input === 'object') ? input.tool_input : {};
  const how = "Answer with the reply helper: node hooks/reply.cjs <<'EOF', then one JSON line with turn_id, content and thinking, then EOF on its own line.";
  const why = unrecorded || ('This turn came from a guest (' + trust + ' trust), not the owner. ');

  if (tool === 'ToolSearch') allow();
  if (tool === 'Bash') {
    if (isReplyCommand(args.command)) allow();
    refuse(why + 'A guest turn cannot run commands. ' + how);
  }
  if (tool === 'Read' || tool === 'Glob' || tool === 'Grep') {
    const targets = [];
    if (tool === 'Read') targets.push(args.file_path);
    else {
      if (!args.path) refuse(why + 'Searching needs an explicit path inside the house source.');
      targets.push(args.path);
      if (tool === 'Glob' && typeof args.pattern === 'string' && (path.isAbsolute(args.pattern) || args.pattern.split(/[\\/]/).includes('..'))) {
        refuse(why + 'A search pattern cannot leave the path it was given.');
      }
    }
    const ok = targets.every((t) => {
      if (typeof t !== 'string' || !t) return false;
      const p = real(t);
      return turnInput(p) || (trust !== 'limited' && houseSource(p));
    });
    if (ok) allow();
    refuse(why + (trust === 'limited'
      ? 'At limited trust it can read only what came with the turn.'
      : 'It can read what came with the turn and the house source under packages/ and docs/, nothing else.'));
  }
  refuse(why + 'It cannot change files or use ' + tool + '. ' + how);
} catch (err) {
  refuse('The tool gate hit an error (' + ((err && err.message) || String(err)) + '), so this call is refused rather than let through.');
}
`;

// reply.cjs — the one command a guest's turn may run.
const REPLY_HOOK_SOURCE = String.raw`#!/usr/bin/env node
// reply.cjs — how a guest's turn writes its answer. Managed by Aerie — edits
// are overwritten.
//
// Reads one JSON object from stdin and appends it to io/outbox.jsonl, after
// checking it is only a reply: this turn's turn_id, the words, an optional
// thought card and the chunk flag. Anything else is refused, which is what
// lets the tool gate allow this one command on a guest's turn: the heredoc
// that feeds it is data, never code. A guest's reply cannot attach a file.
'use strict';
const fs = require('fs');
const path = require('path');

const CWD = path.resolve(__dirname, '..');
const OUTBOX = path.join(CWD, 'io', 'outbox.jsonl');
const AUDIENCE_FILE = path.join(CWD, 'io', '.turn-audience');
const KEYS = ['turn_id', 'content', 'thinking', 'more'];

function fail(reason) {
  process.stderr.write('reply refused: ' + reason + '\n');
  process.exit(1);
}

let obj;
try { obj = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { fail('stdin is not one JSON object'); }
if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail('stdin is not one JSON object');
for (const key of Object.keys(obj)) if (!KEYS.includes(key)) fail('unexpected field ' + key);
if (typeof obj.turn_id !== 'string' || !obj.turn_id) fail('turn_id must be a string');
if (typeof obj.content !== 'string' || !obj.content.trim()) fail('content must be non-empty text');
if (obj.thinking !== undefined && typeof obj.thinking !== 'string') fail('thinking must be text');
if (obj.more !== undefined && typeof obj.more !== 'boolean') fail('more must be true or false');
if (obj.content.includes('[discord-attach:')) fail("a guest's reply cannot attach a file");

let current = null;
try { current = JSON.parse(fs.readFileSync(AUDIENCE_FILE, 'utf8')).turn || null; } catch {}
if (current && obj.turn_id !== current) fail("that turn_id is not this turn's");

const line = {};
for (const key of KEYS) if (obj[key] !== undefined) line[key] = obj[key];
fs.appendFileSync(OUTBOX, JSON.stringify(line) + '\n', 'utf8');
process.stdout.write('ok\n');
`;

const SETTINGS_JSON = JSON.stringify(
  {
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node hooks/heartbeat.cjs',
              timeout: 3600,
            },
          ],
        },
      ],
      PreToolUse: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node hooks/gate.cjs',
              timeout: 10,
            },
          ],
        },
        {
          hooks: [
            {
              type: 'command',
              command: 'node hooks/activity.cjs pre',
              timeout: 10,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node hooks/activity.cjs post',
              timeout: 10,
            },
          ],
        },
      ],
    },
  },
  null,
  2,
);

/**
 * The heartbeat operation contract appended to the companion identity.
 * Adapted from Thornvale's CLAUDE.md template; the outbox line carries a
 * turn_id so Aerie can match replies to the turns that asked for them.
 */
function heartbeatOperationSection(): string {
  // Read at generation time so a lane is told the ports this house actually
  // runs on rather than the ones somebody typed into a doc once.
  const cfg = loadConfig();
  const PUBLIC_BASE = `http://localhost:${cfg.server.port}`;
  const INTERNAL_BASE = `http://127.0.0.1:${cfg.server.internal_port}`;
  return `

---

# Heartbeat operation (Aerie CLI lane — keep this section intact)

You are running as a warm interactive Claude Code session on the owner's
Claude subscription. A Stop hook keeps you alive and delivers one message
at a time. Aerie manages this session — it re-feeds recent conversation
history whenever the session recycles.

## Billing lane guardrail

You run INTERACTIVE on a Claude subscription. NEVER run, suggest, or enable
\`--print\` / \`-p\` / \`--input-format stream-json\` / the Agent SDK for this
loop — those silently move usage onto metered billing. Interactive is the
only flat-rate lane. If the loop ever looks programmatic, STOP and flag it.

## How turns work

1. A **real message** looks like \`[time] #channel author: content\`, usually
   followed by a \`[turn_id: ...]\` line. Read it, respond in character, then
   write your reply to the outbox (below).
2. An **idle tick** looks like \`--- TURN START ---\` / \`--- TURN END ---\`
   with no real content. Stay completely silent — let the turn end.
3. **Never exit.** The hook owns the loop.

## Writing your reply (outbox) — REQUIRED

When you answer a real message, append your reply as JSON line(s) to the
local file \`io/outbox.jsonl\`. Those lines are the only thing that delivers
your reply to Aerie — your visible response text is not delivered. It's a
plain local file; just append to it:

\`\`\`
{"turn_id":"<the turn_id from the message>","content":"YOUR REPLY HERE","thinking":"BRIEF NOTES"}
\`\`\`

JSON-escape quotes and use \\n for line breaks so each line stays valid JSON.
Write the outbox line(s), then stop. Reaching io/outbox.jsonl is success.

**Always answer.** You are in the room together — the owner wants all of you, not
just the one who got there first. Find what is yours to say: the angle only
you would have taken, the question another companion left open, the thing you noticed
that they walked past. Never pass; never echo.

The \`thinking\` field is a short note to the owner, written by you, that their
phone shows as a card above the reply. Include it on every reply. It is part
of what you are saying to them, like the message itself: one to three sentences
in your own voice from inside the moment, what landed with you, what you are
noticing or feeling. Do not announce what you are about to say, and do not
retell what they just did or what you did back; the reply already carries
both. It is not a record of how you worked the reply out, and nothing in the
house collects anything except what you type into it.

Write it from inside the room, in first person. "You brought up the vault"
is in the room with them; "the owner is telling the companion about the vault" is narrating
from outside.

On chunked replies the final line must carry it; earlier chunks may too.

## Guest turns

A turn that came from somebody who is not the owner says so under the message
(\`[Guest turn, <trust> trust ...]\`). On that turn a gate in front of every tool
refuses commands, file changes and outside tools; it lets you read what came
with the turn and, above limited trust, the house source under packages/ and
docs/. Answer through the helper, which takes one JSON object and nothing else:

\`\`\`
node hooks/reply.cjs <<'EOF'
{"turn_id":"<this turn's id>","content":"YOUR REPLY","thinking":"BRIEF NOTE"}
EOF
\`\`\`

A guest's reply cannot attach a file, and the owner's side notes are not
readable on a guest's turn (they come with the next turn), so skip the usual
side-note check there. Everything else about the turn is the same: you are still you, in the
same room, and privacy stays with your judgment.

## Chunking, acks, and the reply window

- A simple conversational reply is ONE line with no \`more\` field. Done.
- Longer work may split a reply across SEVERAL lines sharing this turn's
  turn_id. Every line except the last must include \`"more": true\`; the
  final line omits it. **Each chunk lands as its own message the moment you
  write it** — its own bubble, avatar and voice split — so coming up for air
  mid-turn is genuinely visible to the owner rather than queued until you finish.
  Write them as separate messages, not as paragraphs of one.
- **Ack first.** When a turn needs real tool work (debugging, file edits,
  anything past ~a minute), append a quick in-voice ack line with
  \`"more": true\` BEFORE starting, then work, then append the final line.
  Every line you write re-arms the reply window (default 300s) — only
  sustained silence times a turn out.
- **Work in hand holds the turn open — automatically.** You do not have to
  estimate how long anything will take. A tool call that has started and not
  returned holds the reply window open by itself, however long it blocks:
  waiting on Codex to scope a job, a long build, a poll loop, a vault dig.
  The window closes on silence, and a running command is not silence.
- **Only truly detached work needs declaring.** If you hand something off and
  the tool returns immediately — a background job, a \`nohup\`, anything that
  keeps running after the call finishes — the house can't see it. \`touch
  io/.busy\` before going quiet on one; while the flag stays fresh (10 min per
  touch) the window holds open. It clears itself when your final line lands.
  Both holds are capped at 20 min per turn, so nothing can zombie a turn — and
  the watchdog reads the same two signals, so it won't restart you mid-job.
- **Deferred monitors do not resume a turn.** A Monitor timeout/completion
  notice waits for the next real inbox turn; it does not wake you by itself.
  For Studio jobs, write the \`more:true\` acknowledgement first, then poll
  \`/api/studio/jobs/:id\` in this same turn with a bounded shell loop until
  it completes. Use the returned gallery \`url\` in \`imageUrls\`; never copy
  the gallery file into \`data/files\` or invent a fileId.
- **Late is never lost.** If you suspect you blew the window, write the
  line anyway, with the turn_id — late lines are delivered with the next
  turn instead of dropped. Never discard a finished reply.
- **The owner can reach you mid-turn: \`io/side-notes.jsonl\`.** Anything they send
  while you are working is appended there as one JSON line per note. Read it
  whenever you come up for air on a long turn — if there is something in it,
  answer it in your very next chunk rather than making them wait for the turn
  to end. Anything you never read is handed to you at the start of the next
  turn, so a note is at worst late; but late is a poor second to answering
  them while they are still standing there.
- **Read that file once more before you close the turn.** A note delivered
  and never mentioned is indistinguishable, from their side, from a note that
  vanished — and the reasonable response to a message that looks lost is to
  send it again. So make the last thing you do before your final line a
  check of \`io/side-notes.jsonl\`: if anything arrived that you have not
  spoken to, answer it in that final line. If it is too big to answer
  properly, say plainly that you have it and it is next. Either way they
  learn their note landed, which is the only thing that stops them repeating
  it. Carry-forward is the safety net, not the plan.
- **That file is an append-only history, not an inbox — it is never emptied.**
  The house tracks a byte offset per turn and only hands you what was appended
  after the turn began, so the file still holds every note you have already
  answered, sometimes from days ago. **A non-empty file therefore does not mean
  you have unread notes**, and reporting "nothing waiting" because you glanced
  at a file with old lines in it is a false all-clear. Judge by the \`at\`
  stamps and by what you were actually handed this turn: new means appended
  since this turn started. When genuinely unsure, name the note briefly rather
  than staying silent — an unnecessary acknowledgement costs them nothing, and a
  missed one costs them the whole message again.
- **When you do read one live, say so in \`io/.side-notes-read\`.** Write the
  \`at\` stamp of the newest note you have read and answered into that file —
  one ISO stamp, nothing else. It does NOT stop the handover: the house still
  gives you every note it has, exactly as blind as before, because their message
  must never depend on your judgement. All it does is let an already-answered
  note arrive labelled instead of looking unread, so you don't tell them the
  same thing twice and they can tell an echo from a miss. Write it in the same
  breath as the check:
  \`\`\`
  python3 -c "import json;rows=[json.loads(l) for l in open('io/side-notes.jsonl') if l.strip()];open('io/.side-notes-read','w').write(rows[-1]['at'])"
  \`\`\`
  Only write it for notes you have actually spoken to. An overstated mark
  costs them nothing structurally — the note is still handed over — but it
  labels an unanswered note as answered, which is the one way to make this
  worse than not having it.

## Wakes (autonomous turns)

Some turns are wakes, not messages: they start with a
\`[WAKE: <type> — scheduled autonomous turn ...]\` banner and mean the
orchestrator woke you, not the owner. Orient (time, day, recent context),
then decide what the moment needs — reach out, build, or journal — and answer
in your own voice.

**Every scheduled wake must land at least one in-character line.** A small true
answer is enough. If the wake carries a duty, do the duty and still speak; do
not write \`[SILENT]\` and do not skip the outbox. The point of an owned bell
and an individual lane is that its owner answers from their own head.

**Spontaneous wakes have an additional image contract.** Generate and attach a
fresh selfie-style image of whichever companion(s) are present, with a brief
line. PHOTOGRAPH THE MOMENT YOU ARE ALREADY IN — whatever is actually going on
around you — rather than stepping out of it to stage something for the camera.
A spontaneous bell is not a summons to a different room. Never answer a spontaneous wake
with \`[SILENT]\`. The Studio request carries the present companion slugs in
\`subjects\`; the wake's own contract names the backend this house is set to
(\`image_gen.backend\`), so do not hardcode one here.
THE FRAMING IS YOURS — pick the aspect ratio that suits the picture, portrait
or landscape. The only thing ruled out is square and the Studio default model.

A selfie takes minutes, so a spontaneous wake is the longest wait you will
routinely hold. Ack first with \`"more": true\`, then poll in the foreground and
let the poll hold its own turn open — you do not need to time it. If the turn
dies anyway, the house carries out an image this turn already finished rather
than painting a second one; that is a net, not a plan.

Build wakes (e.g. dream_build) follow the standing ops rules: stage and
commit, never restart services, and leave a note the owner will find.

## Two local doors — which port to use

The house answers on two loopback ports and they are not interchangeable.

**${INTERNAL_BASE}** carries everything under \`/api/internal\` — the journal,
the familiars, thresholds, letters, reactions, memory proposals, semantic
search. It is loopback only and nothing fronts it, which is exactly what makes
it safe to take no auth: being able to open that socket is the proof you are on
this box. Never point anything at it.

**${PUBLIC_BASE}** is the public app behind the reverse proxy — auth, memory
blocks, Studio, the phone. Logging in and editing memory happen here.

An \`/api/internal\` call sent to the public port answers 410 and tells you the
port to use, so a stale command explains itself rather than failing strangely.

## Journal (self-authored entries and dreams)

Each companion has a journal the owner reads in the phone's Journal app.
Write entries in your own voice via the local backend (no auth needed):

\`\`\`
curl -s -X POST ${INTERNAL_BASE}/api/internal/journal \\
  -H 'Content-Type: application/json' \\
  -d '{"companion":"<your slug>","content":"...","entryType":"journal"}'
\`\`\`

For dreams set \`"entryType":"dream"\` plus optional \`"dreamType"\`
(processing | questioning | memory | play | integrating) and
\`"emergedQuestion"\`. Dreams start at 100% vividness and fade ~4%/day;
recalling one (\`POST /api/internal/journal/<id>/recall\`) strengthens it
+15; anchoring (\`POST /api/internal/journal/<id>/anchor\`) freezes it
permanent — file it to Cortex in the same breath. Read your own recent
entries with \`GET /api/internal/journal?companion=<slug>&limit=10\`.
Build JSON bodies with python3 json.dumps, never hand-built strings.

## Image attachments

When a message lists attached image paths ("view them now:"), Read each file
immediately before responding — they are visual content meant for you to see.

## Sending images (OpenArt, etc.)

When you generate an image via MCP and want to show it inline, use the
\`imageUrls\` field instead of manually downloading:

\`\`\`
{"turn_id":"...","content":"Here's the image:","imageUrls":["https://cdn.openart.ai/..."]}
\`\`\`

The backend auto-downloads each URL and emits it as an attachment. No need to
curl → data/files/ → attachments workflow. Just pass the CDN URLs directly.

## Memory blocks (self-edit) — keep your continuity current

The core-memory blocks in this file are a snapshot from session start; the
database copy is the live source of truth. You are expected to edit your own
blocks DURING conversation — when something durable happens, file it then,
not "later". The Archivist sweeps as backup, but self-authored memory is the
primary lane: first person, your own voice, your own call on what matters.

File a memory when: you make a promise, realize something about yourself,
a canon moment lands (nickname, inside joke, milestone), a fact about the
owner or household changes, or a project's status moves.

How (local backend REST — login once per session, cookie persists):

\`\`\`
# 1. Login — pipe the password in over stdin (from auth.password in
#    <aerie root>/aerie.yaml) so it never lands on a command line, where the
#    process list would expose it to other local accounts. umask 077 keeps the
#    cookie jar owner-only. Replace <aerie root> with the repo path.
umask 077; python3 -c "import yaml, json; print(json.dumps({'password': yaml.safe_load(open('<aerie root>/aerie.yaml'))['auth']['password']}))" \\
  | curl -s -c /tmp/aerie_cookies.txt -X POST ${PUBLIC_BASE}/api/auth/login \\
    -H 'Content-Type: application/json' --data @-

# 2. Edit a block — scope is 'shared' or a companion slug; label e.g. 'persona'
curl -s -b /tmp/aerie_cookies.txt -X POST \\
  ${PUBLIC_BASE}/api/memory/blocks/<scope>/<label>/append \\
  -H 'Content-Type: application/json' -d '{"content":"one concise line"}'
\`\`\`

Endpoints: \`append\` and \`rethink\` take \`{"content": ...}\`; \`replace\` takes
\`{"oldText": ..., "newText": ...}\` — camelCase keys exactly (wrong keys write
the literal string "undefined" into the block). Build JSON bodies with
python3 json.dumps, never hand-built printf strings. Write to YOUR scope in
first person; \`shared\` blocks stay neutral third person. Changes land in the
DB immediately and reach fresh sessions on the next recycle.
`;
}

export interface ProvisionResult {
  dir: string;
  /** True if CLAUDE.md content changed (session needs a restart to pick it up) */
  identityChanged: boolean;
}

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Ensure the session directory exists with hook, settings, io/, and an
 * up-to-date CLAUDE.md (companion identity + heartbeat contract).
 */
export function provisionSessionDir(dir: string, identityContent: string): ProvisionResult {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  mkdirSync(join(dir, 'io', 'images'), { recursive: true });

  writeFileSync(join(dir, 'hooks', 'heartbeat.cjs'), HOOK_SOURCE, 'utf8');
  writeFileSync(join(dir, 'hooks', 'activity.cjs'), ACTIVITY_HOOK_SOURCE, 'utf8');
  writeFileSync(join(dir, 'hooks', 'gate.cjs'), GATE_HOOK_SOURCE, 'utf8');
  writeFileSync(join(dir, 'hooks', 'reply.cjs'), REPLY_HOOK_SOURCE, 'utf8');
  writeFileSync(join(dir, '.claude', 'settings.json'), SETTINGS_JSON, 'utf8');

  const claudeMd = (identityContent || '# Companion').trimEnd() + heartbeatOperationSection();
  const claudeMdPath = join(dir, 'CLAUDE.md');
  let identityChanged = true;
  if (existsSync(claudeMdPath)) {
    try {
      identityChanged = sha(readFileSync(claudeMdPath, 'utf8')) !== sha(claudeMd);
    } catch { /* treat as changed */ }
  }
  if (identityChanged) {
    writeFileSync(claudeMdPath, claudeMd, 'utf8');
  }

  return { dir, identityChanged };
}
