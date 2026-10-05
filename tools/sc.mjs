#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// sc — Aerie internal API CLI
// Wraps localhost curl calls into clean commands.
// Thread ID read from .aerie-thread (written per-query by agent.ts)

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// /api/internal has its own loopback port. Resolve it from env, then
// aerie.yaml, then the built-in default — and read internal_port specifically,
// because matching a bare `port:` would find the public one and get a 410.
function getInternalPort() {
  if (process.env.AERIE_INTERNAL_PORT) return process.env.AERIE_INTERNAL_PORT;
  try {
    const yaml = readFileSync(join(__dirname, '..', 'aerie.yaml'), 'utf8');
    const match = yaml.match(/^\s*internal_port:\s*(\d+)/m);
    if (match) return match[1];
  } catch {}
  return '3012';
}

const BASE = `http://127.0.0.1:${getInternalPort()}/api/internal`;

function getThread() {
  try {
    return readFileSync(join(__dirname, '..', '.aerie-thread'), 'utf8').trim();
  } catch {
    return process.env.AERIE_THREAD || '';
  }
}

async function request(method, endpoint, body, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/${endpoint}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    try { console.log(JSON.stringify(JSON.parse(text), null, 2)); }
    catch { console.log(text); }
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      console.error('Error: request timed out');
    } else {
      console.error(`Error: ${e.message}`);
    }
    process.exit(1);
  }
}

async function post(endpoint, body, timeoutMs = 10000) {
  return request('POST', endpoint, body, timeoutMs);
}

async function get(endpoint, timeoutMs = 10000) {
  return request('GET', endpoint, undefined, timeoutMs);
}

async function del(endpoint, timeoutMs = 10000) {
  return request('DELETE', endpoint, undefined, timeoutMs);
}

const [,, cmd, ...args] = process.argv;
const thread = getThread();

// ASKING FOR HELP MUST NEVER BE MISTAKEN FOR CONTENT.
//
// Rose and Sol, Sep 17 2026: in their tree `sc treehouse --help` posted the
// literal words "--help" onto the treehouse wall, because the command takes its
// first argument as the text to post. We have no treehouse command, but the
// SHAPE is here — several commands take a free-text or path first argument and
// would cheerfully act on a flag. So the check sits above the switch, once, for
// every command there is and every command anybody adds later.
const HELP = new Set(['help', '--help', '-h']);
const COMMANDS = 'share, canvas, voice, schedule, timer, react, impulse, watch, tg, search, backfill, notes, sticker';
function usage(forCmd) {
  console.log('sc — Aerie internal API CLI');
  if (forCmd) console.log(`No help written for "${forCmd}" yet — read tools/sc.mjs; it is short.`);
  console.log(`Commands: ${COMMANDS}`);
}
if (!cmd || HELP.has(cmd)) {
  usage();
  process.exit(0);
}
if (HELP.has(args[0])) {
  usage(cmd);
  process.exit(0);
}

switch (cmd) {
  case 'share':
    await post('share', { path: args[0], threadId: thread });
    break;

  case 'canvas': {
    const sub = args[0];
    if (sub === 'create') {
      await post('canvas', {
        action: 'create', title: args[1], filePath: args[2],
        contentType: args[3] || 'markdown', threadId: thread,
      });
    } else if (sub === 'create-inline') {
      await post('canvas', {
        action: 'create', title: args[1], content: args[2],
        contentType: args[3] || 'text', threadId: thread,
      });
    } else if (sub === 'update') {
      await post('canvas', { action: 'update', canvasId: args[1], filePath: args[2] });
    } else {
      console.log('Usage: sc canvas create|create-inline|update ...');
    }
    break;
  }

  case 'voice': {
    // sc voice "text" [--voice <name>] [--voice-id <id>]
    // Stitched multi-voice TTS can run 30-60s on slow ElevenLabs days, so
    // give this path a generous timeout — the default 10s eats them alive.
    const voiceBody = { text: args[0], threadId: thread };
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--voice' && args[i + 1]) { voiceBody.voice = args[++i]; }
      else if (args[i] === '--voice-id' && args[i + 1]) { voiceBody.voiceId = args[++i]; }
    }
    await post('tts', voiceBody, 5 * 60 * 1000);
    break;
  }

  case 'schedule': {
    const body = { action: args[0] };
    if (args[1]) body.wakeType = args[1];
    if (args[2]) body.cronExpr = args[2];
    await post('orchestrator', body);
    break;
  }

  case 'timer': {
    const sub = args[0];
    if (sub === 'create') {
      const body = {
        action: 'create', label: args[1], context: args[2],
        fireAt: args[3], threadId: thread,
      };
      const pi = args.indexOf('--prompt');
      if (pi !== -1 && args[pi + 1]) body.prompt = args[pi + 1];
      await post('timer', body);
    } else if (sub === 'list') {
      await post('timer', { action: 'list' });
    } else if (sub === 'cancel') {
      await post('timer', { action: 'cancel', timerId: args[1] });
    } else {
      console.log('Usage: sc timer create|list|cancel ...');
    }
    break;
  }

  case 'react':
    if (!args[0] || !args[1]) {
      console.log('Usage: sc react <last|last-N> <emoji> [remove]');
    } else {
      const body = { target: args[0], emoji: args[1], threadId: thread };
      if (args[2] === 'remove') body.action = 'remove';
      await post('react', body);
    }
    break;

  case 'impulse': {
    const sub = args[0];
    if (sub === 'create') {
      const label = args[1];
      if (!label) { console.log('Usage: sc impulse create "label" --condition type:args --prompt "text"'); break; }
      const conditions = [];
      let prompt = undefined;
      let i = 2;
      while (i < args.length) {
        if (args[i] === '--condition' && args[i + 1]) {
          conditions.push(parseCondition(args[i + 1]));
          i += 2;
        } else if (args[i] === '--prompt' && args[i + 1]) {
          prompt = args[i + 1];
          i += 2;
        } else { i++; }
      }
      if (conditions.length === 0) { console.log('At least one --condition required'); break; }
      await post('trigger', { action: 'create', kind: 'impulse', label, conditions, prompt, threadId: thread });
    } else if (sub === 'list') {
      await post('trigger', { action: 'list', kind: 'impulse' });
    } else if (sub === 'cancel') {
      await post('trigger', { action: 'cancel', triggerId: args[1] });
    } else {
      console.log('Usage: sc impulse create|list|cancel ...');
    }
    break;
  }

  case 'watch': {
    const sub = args[0];
    if (sub === 'create') {
      const label = args[1];
      if (!label) { console.log('Usage: sc watch create "label" --condition type:args --prompt "text" --cooldown N'); break; }
      const conditions = [];
      let prompt = undefined;
      let cooldownMinutes = undefined;
      let i = 2;
      while (i < args.length) {
        if (args[i] === '--condition' && args[i + 1]) {
          conditions.push(parseCondition(args[i + 1]));
          i += 2;
        } else if (args[i] === '--prompt' && args[i + 1]) {
          prompt = args[i + 1];
          i += 2;
        } else if (args[i] === '--cooldown' && args[i + 1]) {
          cooldownMinutes = args[i + 1];
          i += 2;
        } else { i++; }
      }
      if (conditions.length === 0) { console.log('At least one --condition required'); break; }
      await post('trigger', { action: 'create', kind: 'watcher', label, conditions, prompt, threadId: thread, cooldownMinutes });
    } else if (sub === 'list') {
      await post('trigger', { action: 'list', kind: 'watcher' });
    } else if (sub === 'cancel') {
      await post('trigger', { action: 'cancel', triggerId: args[1] });
    } else {
      console.log('Usage: sc watch create|list|cancel ...');
    }
    break;
  }

  case 'tg': {
    const sub = args[0];
    if (!sub) { console.log('Usage: sc tg photo|doc|gif|voice|text ...'); break; }

    const typeMap = { photo: 'photo', doc: 'document', voice: 'voice', text: 'text', gif: 'gif', react: 'react' };
    const type = typeMap[sub];
    if (!type) { console.log(`Unknown tg type: ${sub}. Use photo, doc, gif, voice, text, or react.`); break; }

    if (type === 'voice' || type === 'text') {
      await post('telegram-send', { type, text: args[1] }, 30000);
    } else if (type === 'gif') {
      await post('telegram-send', { type: 'gif', query: args[1], caption: args[2] }, 30000);
    } else if (type === 'react') {
      await post('telegram-send', { type: 'react', target: args[1], emoji: args[2] }, 10000);
    } else {
      let source, caption;
      if (args[1] === '--url') {
        source = { url: args[2] };
        caption = args[3];
      } else {
        source = { path: args[1] };
        caption = args[2];
      }
      const body = { type, caption };
      if (source.url) body.url = source.url;
      if (source.path) body.path = source.path;
      if (type === 'document') body.filename = args[1] ? args[1].split('/').pop().split('\\').pop() : 'file';
      await post('telegram-send', body, 30000);
    }
    break;
  }

  case 'search': {
    const query = args[0];
    if (!query) { console.log('Usage: sc search "query" [--thread ID] [--limit N]'); break; }
    const body = { query };
    const ti = args.indexOf('--thread');
    if (ti !== -1 && args[ti + 1]) body.threadId = args[ti + 1];
    const li = args.indexOf('--limit');
    if (li !== -1 && args[li + 1]) body.limit = parseInt(args[li + 1], 10);
    await post('search-semantic', body, 30000);
    break;
  }

  case 'backfill': {
    const sub = args[0];
    if (sub === 'start') {
      const batchSize = args[1] ? parseInt(args[1], 10) : 50;
      const intervalMs = args[2] ? parseInt(args[2], 10) : 5000;
      await post('embed-backfill', { background: true, batchSize, intervalMs }, 10000);
    } else if (sub === 'stop') {
      await post('embed-backfill', { action: 'stop' }, 10000);
    } else if (sub === 'status') {
      await post('embed-backfill', { action: 'status' }, 10000);
    } else {
      const batchSize = sub ? parseInt(sub, 10) : 50;
      await post('embed-backfill', { batchSize }, 120000);
    }
    break;
  }

  case 'notes': {
    const sub = args[0];
    if (sub === 'list' || !sub) {
      await get('notes');
    } else if (sub === 'post') {
      // Positional: sc notes post "text" [#color]
      // Optional:   --from <name>   to override sender (multi-companion setups)
      const rest = args.slice(1);
      const fromIdx = rest.findIndex((a) => a === '--from');
      let sender;
      if (fromIdx !== -1) {
        sender = rest[fromIdx + 1];
        rest.splice(fromIdx, 2);
      }
      const text = rest[0];
      const color = rest[1];
      if (!text) {
        console.log('Usage: sc notes post "text" [#color] [--from <name>]');
        process.exit(1);
      }
      const body = { text };
      if (color) body.color = color;
      if (sender) body.sender = sender;
      await post('note', body);
    } else if (sub === 'delete') {
      const id = args[1];
      if (!id) {
        console.log('Usage: sc notes delete <id>');
        process.exit(1);
      }
      await del(`note/${id}`);
    } else {
      console.log('Usage: sc notes list | post "text" [#color] [--from <name>] | delete <id>');
      process.exit(1);
    }
    break;
  }

  case 'sticker': {
    const pack = args[0];
    const name = args[1];
    if (!pack || !name) {
      console.log('Usage: sc sticker <pack> <name>');
      console.log('Example: sc sticker <companion-slug> wave');
      break;
    }
    await post('sticker-send', { pack, name, threadId: thread });
    break;
  }

  default:
    // The old list here named eleven commands and the file had more.
    console.error(`Unknown command: ${cmd}`);
    usage();
    process.exitCode = 1;
    break;
}

// --- Condition shorthand parser ---
function parseCondition(shorthand) {
  if (shorthand === 'agent_free') return { type: 'agent_free' };

  const parts = shorthand.split(':');
  const type = parts[0];

  switch (type) {
    case 'presence_state':
      return { type: 'presence_state', state: parts[1] };
    case 'presence_transition':
      return { type: 'presence_transition', from: parts[1], to: parts[2] };
    case 'time_window':
      if (parts.length >= 5) {
        return { type: 'time_window', after: `${parts[1]}:${parts[2]}`, before: `${parts[3]}:${parts[4]}` };
      }
      return { type: 'time_window', after: `${parts[1]}:${parts[2]}` };
    case 'routine_missing':
      return { type: 'routine_missing', routine: parts[1], after_hour: parseInt(parts[2], 10) };
    default:
      console.error(`Unknown condition type: ${type}`);
      process.exit(1);
  }
}
