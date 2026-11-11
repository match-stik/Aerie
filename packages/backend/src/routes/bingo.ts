// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import crypto from 'crypto';
import { Router } from 'express';
import type { AgentService } from '../services/agent.js';
import {
  BingoError, OWNER, PATTERNS, POWERS, SHAPES, callNumber, claimBingo, daub, describeBingo, loadBingoHouse,
  loadCurrentBingo, newBingo, saveBingo, seatOf, setSeat, textsSince, toggleHouse, undaub, usePower, viewBingo,
  type BingoState, type Pattern, type Power, type Shape,
} from '../services/db/bingo.js';
import { assignCompanionToThread, listCompanions } from '../services/db/companions.js';
import { createMessage, getMessages } from '../services/db/messages.js';
import { getDb } from '../services/db/state.js';
import { createThread, getThread } from '../services/db/threads.js';
import { registry } from '../services/ws.js';
import { ownerDisplayName } from '../services/db/owner-name.js';

/** The phone's door to the bingo table, behind the login like every game. */
const router = Router();

export function bingoCallers(): string[] {
  return listCompanions().map((c) => c.slug).filter(Boolean);
}

function labelOf(who: string): string {
  if (who === OWNER) return ownerDisplayName(true);
  if (who === 'house') return 'The house';
  const c = (listCompanions() as Array<{ slug: string; display_name?: string | null }>).find((x) => x.slug === who);
  return c?.display_name || who;
}

export function bingoView(state: BingoState | null) {
  if (!state) return { game: null };
  return { game: viewBingo(state, textsSince(state.startedAt)) };
}

// ── the room's own thread, the same shape as the Card Room's ──────────────

const BINGO_THREAD_KEY = 'bingo.thread_id';

export function bingoThreadId(): string {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(BINGO_THREAD_KEY) as { value: string } | undefined;
  if (row?.value && getThread(row.value)) return row.value;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  createThread({ id, name: 'Bingo Night', type: 'named', createdAt: now, sessionType: 'v2' });
  // Participants, no primary: naming a leader would hand the room its own cold
  // lane (the Card Room and the Fleet Room learned that first).
  for (const companion of listCompanions()) assignCompanionToThread(id, companion.id, 'participant', true);
  getDb().prepare('UPDATE threads SET archived_at = ? WHERE id = ?').run(now, id);
  getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(BINGO_THREAD_KEY, id);
  createMessage({ id: crypto.randomUUID(), threadId: id, role: 'system', content: 'Bingo Night opened. Four seats, one cage.', platform: 'api', createdAt: now });
  return id;
}

function say(text: string): void {
  createMessage({ id: crypto.randomUUID(), threadId: bingoThreadId(), role: 'system', content: text, platform: 'api', createdAt: new Date().toISOString() });
}

let talking = false;
let talkError: string | null = null;

function current(): BingoState {
  const state = loadCurrentBingo();
  if (!state) throw new BingoError('No game on the table', 404);
  return state;
}

function sendError(res: import('express').Response, error: unknown): void {
  if (error instanceof BingoError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error('[Bingo]', error);
  res.status(500).json({ error: 'The cage jammed' });
}

/** Save, tell every open phone, and say any new bingo out loud in the room. */
function commit(state: BingoState, winsBefore: number, res: import('express').Response): void {
  for (const win of state.wins.slice(winsBefore)) {
    say(`${labelOf(win.who)} calls BINGO on card ${win.card + 1}.${state.done ? ' That was the last one of the round.' : ''}`);
  }
  saveBingo(state);
  registry.broadcast({ type: 'card_table_update', tableId: state.id });
  res.json(bingoView(state));
}

router.get('/', (_req, res) => {
  try { res.json(bingoView(loadCurrentBingo())); } catch (e) { sendError(res, e); }
});

router.post('/new', (req, res) => {
  try {
    const prior = loadCurrentBingo();
    const mine = prior ? seatOf(prior, OWNER) : null;
    const shapes: Record<string, Shape> = {};
    for (const seat of prior?.seats ?? []) if (seat.who !== OWNER) shapes[seat.who] = seat.shape;
    const pattern = PATTERNS.includes(req.body?.pattern) ? req.body.pattern as Pattern : prior?.pattern;
    const state = newBingo({
      callers: bingoCallers(),
      moments: loadBingoHouse().moments,
      pattern,
      cardsEach: Number(req.body?.cardsEach) || prior?.cardsEach || 1,
      owner: mine ? { autoPower: mine.autoPower, autoDaub: mine.autoDaub, shape: mine.shape } : undefined,
      shapes,
    });
    say(`New round: ${state.pattern === 'line' ? 'any line' : state.pattern}, ${state.cardsEach} card${state.cardsEach > 1 ? 's' : ''} each, ${state.cap} bingo${state.cap > 1 ? 's' : ''} to give out.`);
    commit(state, 0, res);
  } catch (e) { sendError(res, e); }
});

router.post('/call', (_req, res) => {
  try {
    const state = current();
    const before = state.wins.length;
    callNumber(state, { lines: loadBingoHouse().lines });
    commit(state, before, res);
  } catch (e) { sendError(res, e); }
});

router.post('/daub', (req, res) => {
  try {
    const state = current();
    const before = state.wins.length;
    const card = Number(req.body?.card) || 0;
    const n = Number(req.body?.n);
    if (req.body?.off) undaub(state, OWNER, card, n); else daub(state, OWNER, card, n);
    commit(state, before, res);
  } catch (e) { sendError(res, e); }
});

router.post('/claim', (_req, res) => {
  try {
    const state = current();
    const before = state.wins.length;
    const out = claimBingo(state, OWNER);
    if (!out.won) say(`${ownerDisplayName(true)} called a false bingo. The dauber is frozen for two balls.`);
    commit(state, before, res);
  } catch (e) { sendError(res, e); }
});

router.post('/power', (req, res) => {
  try {
    const state = current();
    const before = state.wins.length;
    const power = req.body?.power as Power;
    if (!POWERS.includes(power)) throw new BingoError('No such power-up');
    const t = req.body?.target;
    const target = t && typeof t === 'object' ? { card: Number(t.card), row: Number(t.row), col: Number(t.col) } : undefined;
    usePower(state, OWNER, { power, target });
    commit(state, before, res);
  } catch (e) { sendError(res, e); }
});

router.post('/seat', (req, res) => {
  try {
    const state = current();
    const body = req.body ?? {};
    setSeat(state, OWNER, {
      autoPower: typeof body.autoPower === 'boolean' ? body.autoPower : undefined,
      autoDaub: typeof body.autoDaub === 'boolean' ? body.autoDaub : undefined,
      shape: SHAPES.includes(body.shape) ? body.shape : undefined,
    });
    commit(state, state.wins.length, res);
  } catch (e) { sendError(res, e); }
});

router.post('/house', (req, res) => {
  try {
    const state = current();
    toggleHouse(state, OWNER, Number(req.body?.row), Number(req.body?.col));
    commit(state, state.wins.length, res);
  } catch (e) { sendError(res, e); }
});

// ── the rail ───────────────────────────────────────────────────────────────

router.get('/rail', (_req, res) => {
  try {
    const threadId = bingoThreadId();
    const companionSlugs = new Map(listCompanions().map((c) => [c.id, c.slug]));
    const messages = getMessages({ threadId, limit: 60 }).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
      companionSlug: m.companion_id ? companionSlugs.get(m.companion_id) ?? null : null,
    }));
    res.json({ messages, threadId, companionPending: talking, companionError: talkError });
  } catch (e) { sendError(res, e); }
});

export function buildBingoPrompt(board: string | null, content: string): string {
  return [
    '[BINGO NIGHT — live game conversation]',
    `A real side room shared by ${ownerDisplayName()} and the companions, everybody at one bingo table. Stay in character and answer naturally.`,
    'This is a game turn, not a software task. Do not inspect or edit code.',
    board ? `The table as it stands right now:\n${board}` : 'Nothing dealt yet.',
    'Talk about THIS game: your own cards, how close you are, who is frozen, what power-up somebody is sitting on. Being specific is the point of being at the table, and trash talk is welcome.',
    'Your final spoken reply is written into the Bingo Night rail automatically.',
    'Use the normal bold sigil headers. Real table talk, not a report, and a quick beat need not become a monologue.',
    '',
    `${ownerDisplayName(true)} just said this to you, and it is what you are answering:`,
    content,
  ].join('\n');
}

router.post('/chat', (req, res) => {
  const agentService = req.app.locals.agentService as AgentService | undefined;
  if (!agentService) {
    res.status(503).json({ error: 'The companion lane is not available' });
    return;
  }
  const content = String(req.body?.content ?? '').trim();
  if (!content) { res.status(400).json({ error: 'Say something into the room first' }); return; }
  if (talking) { res.status(409).json({ error: 'They are already talking' }); return; }
  try {
    const threadId = bingoThreadId();
    const state = loadCurrentBingo();
    createMessage({
      id: crypto.randomUUID(), threadId, role: 'user', content, platform: 'api',
      metadata: { room: 'bingo' }, createdAt: new Date().toISOString(),
    });
    talking = true;
    talkError = null;
    const tableId = state?.id ?? 'bingo';
    registry.broadcast({ type: 'card_table_update', tableId });
    res.status(202).json({ ok: true });
    const prompt = buildBingoPrompt(state ? describeBingo(state, labelOf) : null, content);
    setImmediate(() => {
      void (async () => {
        try {
          await agentService.processMessage(threadId, prompt, { name: 'Bingo Night', type: 'named' }, { platform: 'api' });
        } catch (caught) {
          console.error('[Bingo] Companion turn failed:', caught);
          talkError = 'The line to the table dropped. Say something else to call them back.';
        } finally {
          talking = false;
          registry.broadcast({ type: 'card_table_update', tableId });
        }
      })();
    });
  } catch (e) { sendError(res, e); }
});

export default router;
