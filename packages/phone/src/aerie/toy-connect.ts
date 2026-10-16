// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The owner taps on Connect, followed by one tracker for the whole app
// (lib/toy-connect.ts says why), and the connection log they leave in the
// house's error log (lib/toy-connect-log.ts says how it stays small).
//
// It listens from the moment the app starts with the toy bridge, not from
// when the Toys page opens, so a tap is followed to its end even if the owner leaves
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
});

let listening = false;

/** Once, when the app starts with the toy bridge. */
export function startToyConnectWatch(): void {
  if (listening) return;
  listening = true;
  void LovenseToys.addListener('connection', (c) => tracker.connection(c.toyId, c.state));
  void LovenseToys.addListener('toyError', (e) => tracker.error(e));
  void LovenseToys.addListener('toyFound', (toy) => tracker.found(toy.toyId, !!toy.connected, typeof toy.rssi === 'number' ? toy.rssi : undefined));
  void LovenseToys.addListener('searchFinished', () => tracker.search('finished'));
}

/** The owner tapped Connect on a toy. */
export function startToyConnect(toyId: string, ctx: ConnectContext): void {
  startToyConnectWatch();
  tracker.start(toyId, ctx);
}

/** Which toys are connecting, and whether Connect may be pressed again. */
export function useToyConnects(): Readonly<Record<string, ConnectView>> {
  return useSyncExternalStore(tracker.subscribe, tracker.view, tracker.view);
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
