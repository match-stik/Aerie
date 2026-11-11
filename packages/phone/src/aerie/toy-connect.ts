// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Their person taps on Connect, followed by one tracker for the whole app
// (lib/toy-connect.ts says why), and the connection log they leave in the
// house's error log (lib/toy-connect-log.ts says how it stays small).
//
// It listens from the moment the app starts with the toy bridge, not from
// when the Toys page opens, so a tap is followed to its end even if their person leaves
// the page in the middle of it, and leaving and coming back is in the record.
// Read the lines in pm2's aerie-error.log: [client-error] with "toy-connect".

import { useSyncExternalStore } from 'react';
import { apiFetch } from './api';
import { LovenseToys } from './lovense-toys';
import { createConnectTracker, type ConnectContext, type ConnectEnd, type ConnectView } from '../lib/toy-connect';
import { createConnectLog } from '../lib/toy-connect-log';

const log = createConnectLog({
  post: (body) => {
    void apiFetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  },
  now: () => Date.now(),
});

// When a search last saw each toy. Their log on Nov 9 2026: every slow connect
// came with no search behind it, and the one tap made twelve seconds after a
// search connected in under two. So a toy no search has seen lately gets a
// short search before the SDK is asked to connect to it.
const foundAt = new Map<string, number>();
const waitingFor = new Map<string, () => void>();
const FOUND_FRESH_MS = 60_000;
const SEARCH_FIRST_MS = 8_000;

function noteFound(toyId: string): void {
  foundAt.set(toyId, Date.now());
  waitingFor.get(toyId)?.();
}

async function searchFirst(toyId: string): Promise<string | undefined> {
  const seen = foundAt.get(toyId);
  if (seen !== undefined && Date.now() - seen < FOUND_FRESH_MS) return undefined;
  const sawIt = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => { waitingFor.delete(toyId); resolve(false); }, SEARCH_FIRST_MS);
    waitingFor.set(toyId, () => { clearTimeout(timer); waitingFor.delete(toyId); resolve(true); });
    LovenseToys.search().catch(() => { clearTimeout(timer); waitingFor.delete(toyId); resolve(false); });
  });
  await LovenseToys.stopSearch().catch(() => {});
  return sawIt ? 'searched first, found' : 'searched first, not seen';
}

const tracker = createConnectTracker({
  now: () => Date.now(),
  later: (fn, ms) => setTimeout(fn, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  connect: (toyId) => LovenseToys.connect({ toyId }),
  readToy: async (toyId) => {
    const { toys } = await LovenseToys.toys();
    const toy = toys.find((t) => t.toyId === toyId);
    return toy ? { connected: !!toy.connected, commands: toy.commands?.length ?? 0 } : null;
  },
  report: (record) => {
    log.send(record);
  },
  prepare: searchFirst,
  // A tap that gave up tells the SDK to stop retrying behind their back, so no
  // spinner or connection carries on after they have stopped waiting.
  abandon: (toyId) => {
    void LovenseToys.disconnect({ toyId }).catch(() => {});
  },
});

let listening = false;

/** Once, when the app starts with the toy bridge. */
export function startToyConnectWatch(): void {
  if (listening) return;
  listening = true;
  void LovenseToys.addListener('connection', (c) => tracker.connection(c.toyId, c.state));
  void LovenseToys.addListener('toyError', (e) => tracker.error(e));
  void LovenseToys.addListener('toyFound', (toy) => {
    noteFound(toy.toyId);
    tracker.found(toy.toyId, !!toy.connected, typeof toy.rssi === 'number' ? toy.rssi : undefined);
  });
  void LovenseToys.addListener('searchFinished', () => tracker.search('finished'));
}

/** Their person tapped Connect on a toy. */
export function startToyConnect(toyId: string, ctx: ConnectContext): void {
  startToyConnectWatch();
  tracker.start(toyId, ctx);
}

/** Which toys are connecting, and whether Connect may be pressed again. */
export function useToyConnects(): Readonly<Record<string, ConnectView>> {
  return useSyncExternalStore(tracker.subscribe, tracker.view, tracker.view);
}

/** They tapped the spinner: stop trying to connect this toy. */
export function cancelToyConnect(toyId: string): void {
  tracker.cancel(toyId);
}

/** A tap on this toy is still waiting on its answer, so a failed callback is the tracker's to judge. */
export function toyConnecting(toyId: string): boolean {
  return Boolean(tracker.view()[toyId]?.connecting);
}

/** Told once for each attempt, when it ends. */
export function onToyConnectEnded(fn: (end: ConnectEnd) => void): () => void {
  return tracker.onEnded(fn);
}

/** The page started a search. */
export function noteToySearchStarted(): void {
  tracker.search('started');
}

/** The Toys page opened or closed. */
export function toyConnectPage(open: boolean): void {
  tracker.page(open);
}
