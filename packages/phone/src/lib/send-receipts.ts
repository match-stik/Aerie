// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A message they send is only known to have landed when the house sends it
// back: the server saves it and broadcasts it to every phone, and that copy
// carries the receipt tag the phone put on it. Until then the send is watched;
// if the copy has not come back in time, it is called not sent and offered
// again, exactly as it was (their ask, Nov 9 2026: the bathroom wifi ate a whole
// message as they pressed send, the box was already empty and the house never
// had it). A copy that turns up late still clears it, so nothing is offered
// twice for a message that landed.
import { useSyncExternalStore } from 'react';

export const RECEIPT_KEY = 'clientNonce';
export const RECEIPT_TIMEOUT_MS = 12_000;
/** When the phone itself says it has no connection there is nothing to wait for
 *  (theirs, Nov 9 2026: the tab took a little while to show with their data off). */
export const RECEIPT_OFFLINE_MS = 1_500;

export interface WatchedSend {
  nonce: string;
  threadId: string;
  content: string;
  contentType: 'text' | 'image' | 'audio' | 'file' | 'sticker';
  metadata?: Record<string, unknown>;
  replyToId?: string;
  sentAt: number;
}

export interface SendWatchDeps {
  timeoutMs?: number;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  /** Take an unsent copy back out of any reconnect queue, so a retry cannot double it. */
  unqueue?: (nonce: string) => void;
}

export function createSendWatch(deps: SendWatchDeps) {
  const timeoutMs = deps.timeoutMs ?? RECEIPT_TIMEOUT_MS;
  const waiting = new Map<string, { send: WatchedSend; handle: unknown }>();
  let failed: WatchedSend[] = [];
  const listeners = new Set<() => void>();
  const changed = () => { for (const l of listeners) l(); };

  return {
    /** Start watching a send that has just been handed to the socket. */
    watch(send: WatchedSend, waitMs = timeoutMs): void {
      const old = waiting.get(send.nonce);
      if (old) deps.cancel(old.handle);
      const handle = deps.schedule(() => {
        if (!waiting.has(send.nonce)) return;
        waiting.delete(send.nonce);
        deps.unqueue?.(send.nonce);
        failed = [...failed.filter((f) => f.nonce !== send.nonce), send];
        changed();
      }, waitMs);
      waiting.set(send.nonce, { send, handle });
    },
    /** The house sent a message back carrying this tag: it landed. */
    heard(nonce: unknown): boolean {
      if (typeof nonce !== 'string' || !nonce) return false;
      const w = waiting.get(nonce);
      if (w) {
        deps.cancel(w.handle);
        waiting.delete(nonce);
      }
      const wasFailed = failed.some((f) => f.nonce === nonce);
      if (wasFailed) {
        failed = failed.filter((f) => f.nonce !== nonce);
        changed();
      }
      return !!w || wasFailed;
    },
    /** Take a failed send off the list, for a retry or a dismiss. */
    take(nonce: string): WatchedSend | null {
      const hit = failed.find((f) => f.nonce === nonce) || null;
      if (hit) {
        failed = failed.filter((f) => f.nonce !== nonce);
        changed();
      }
      return hit;
    },
    failed: () => failed,
    waitingCount: () => waiting.size,
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

export type SendWatch = ReturnType<typeof createSendWatch>;

export function newReceiptNonce(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** What the tab shows of a send: its words, or what it carried. */
export function failedSendPreview(send: WatchedSend): string {
  const text = (send.content || '').replace(/\s+/g, ' ').trim();
  const pics = Array.isArray(send.metadata?.attachments) ? (send.metadata!.attachments as unknown[]).length : 0;
  if (text) return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  if (pics) return pics === 1 ? 'a picture' : `${pics} pictures`;
  return 'your message';
}

export function useFailedSends(watch: SendWatch): WatchedSend[] {
  return useSyncExternalStore(watch.subscribe, watch.failed, watch.failed);
}
