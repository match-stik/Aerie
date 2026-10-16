// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The connection log's road to the house: each connect attempt the Toys page
// starts (lib/toy-connect.ts) goes as one line on the same road the crash
// reports and the keyboard recorder use, POST /api/client-errors, tagged
// where "toy-connect", and lands in pm2's aerie-error.log as a [client-error]
// line. The summary rides in message (the house keeps 500 characters) and the
// steps in stack (2000), so it needs nothing new from the house.
//
// It can never flood: an attempt that repeats the last one step for step
// inside ten minutes is folded into a count, at most twelve lines go in any
// ten minutes, and whatever was folded or held back is counted on the next
// line that goes. Kept free of the app so the limits can be checked here.

import type { ConnectRecord, ConnectStep } from './toy-connect';

export const CONNECT_LOG_WHERE = 'toy-connect';
const MESSAGE_MAX = 500;
const STACK_MAX = 2000;

export interface ConnectLogBody {
  where: typeof CONNECT_LOG_WHERE;
  message: string;
  stack: string;
}

function summary(record: ConnectRecord, counts: { folded: number; held: number }) {
  const ctx = record.ctx ?? { scanning: false };
  return {
    kind: record.kind,
    toy: record.name,
    id: record.toyId,
    try: record.try,
    outcome: record.outcome,
    ...(record.ms !== undefined ? { ms: record.ms } : {}),
    ...(record.kind === 'attempt'
      ? {
          scan: ctx.scanning,
          bt: ctx.bluetoothOn ?? null,
          token: ctx.tokenSet ?? null,
          shown: ctx.shownConnected ?? null,
          foundAgoS: record.found ? Math.round(record.found.agoMs / 1000) : null,
          rssi: record.found?.rssi ?? null,
          after: record.after ?? null,
        }
      : {}),
    ...(record.dropped ? { dropped: record.dropped } : {}),
    ...(counts.folded ? { folded: counts.folded } : {}),
    ...(counts.held ? { held: counts.held } : {}),
  };
}

/** The steps as JSON within the house's limit: the first few and as many of the last as fit. */
function fitSteps(steps: ConnectStep[]): string {
  const whole = JSON.stringify(steps);
  if (whole.length <= STACK_MAX) return whole;
  const head = steps.slice(0, 6);
  for (let keep = steps.length - head.length - 1; keep >= 0; keep--) {
    const tail = keep > 0 ? steps.slice(steps.length - keep) : [];
    const cut = steps.length - head.length - tail.length;
    const text = JSON.stringify([...head, [-1, `${cut} steps cut`], ...tail]);
    if (text.length <= STACK_MAX) return text;
  }
  return JSON.stringify(head).slice(0, STACK_MAX);
}

/** What one attempt posts. */
export function connectLogBody(record: ConnectRecord, counts = { folded: 0, held: 0 }): ConnectLogBody {
  let message = JSON.stringify(summary(record, counts));
  if (message.length > MESSAGE_MAX) message = JSON.stringify({ ...summary(record, counts), toy: record.name.slice(0, 12), after: null }).slice(0, MESSAGE_MAX);
  return { where: CONNECT_LOG_WHERE, message, stack: fitSteps(record.steps) };
}

function signature(record: ConnectRecord): string {
  return [record.kind, record.toyId, record.outcome, ...record.steps.map((s) => s[1])].join('|');
}

export function createConnectLog(deps: { post: (body: ConnectLogBody) => void; now: () => number; windowMs?: number; max?: number }) {
  const windowMs = deps.windowMs ?? 10 * 60_000;
  const max = deps.max ?? 12;
  let sentAt: number[] = [];
  let lastSig = '';
  let lastSigAt = -Infinity;
  let folded = 0;
  let held = 0;
  return {
    send(record: ConnectRecord): 'sent' | 'folded' | 'held' {
      const now = deps.now();
      const sig = signature(record);
      if (sig === lastSig && now - lastSigAt < windowMs) {
        folded++;
        return 'folded';
      }
      sentAt = sentAt.filter((at) => now - at < windowMs);
      if (sentAt.length >= max) {
        held++;
        return 'held';
      }
      deps.post(connectLogBody(record, { folded, held }));
      folded = 0;
      held = 0;
      lastSig = sig;
      lastSigAt = now;
      sentAt.push(now);
      return 'sent';
    },
  };
}
