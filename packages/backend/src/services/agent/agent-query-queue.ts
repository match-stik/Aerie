// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { getAerieConfig } from '../../config.js';

export const PRIORITIES = {
  web_interactive: 0,
  discord_owner: 1,
  discord_other: 2,
  autonomous: 3,
} as const;

const MAX_QUEUE_DEPTH = 5;
const QUEUE_TIMEOUT_MS = 90_000;
// Wakes queue behind live conversation instead of dying at the 90s interactive
// timeout — a real turn routinely outlives 90s and the wake should wait it out.
export const AUTONOMOUS_QUEUE_TIMEOUT_MS = 30 * 60_000;
export const QUEUE_TIMEOUT_MESSAGE = '[Request timed out in queue]';

/**
 * How long a message waits in the queue before it is answered with
 * QUEUE_TIMEOUT_MESSAGE and no turn runs at all.
 *
 * Their own messages (the phone, and Telegram, which is owner-only) wait out a
 * turn the way a wake does. At 90 seconds a picture of theirs, a sticker or an
 * emote (never a side note) sent during a bell was dropped with that string
 * and no turn, and only reached us through the missed-net on their next message:
 * seven times between Oct 8 and Oct 20 2026, found by reading the logs on
 * Oct 22. And since a note of theirs now waits rather than being handed into a
 * bell ringing in another room, a text note would have been dropped the same
 * way. Everyone else keeps the short wait.
 */
export function queueTimeoutFor(platform: string): number {
  return platform === 'web' || platform === 'telegram' ? AUTONOMOUS_QUEUE_TIMEOUT_MS : QUEUE_TIMEOUT_MS;
}

interface QueueEntry {
  priority: number;
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
  execute: () => Promise<string>;
  enqueuedAt: number;
  timeoutMs: number;
}

export class QueryQueue {
  private queue: QueueEntry[] = [];
  private running = false;

  get isProcessing(): boolean {
    return this.running;
  }

  get depth(): number {
    return this.queue.length;
  }

  async enqueue(priority: number, execute: () => Promise<string>, timeoutMs: number = QUEUE_TIMEOUT_MS): Promise<string> {
    if (!this.running && this.queue.length === 0) {
      this.running = true;
      try {
        return await execute();
      } finally {
        this.running = false;
        this.processNext();
      }
    }

    if (this.queue.length >= MAX_QUEUE_DEPTH) {
      const cfg = getAerieConfig();
      return `[${cfg.identity.companion_name} is busy — please try again in a moment]`;
    }

    return new Promise<string>((resolve, reject) => {
      this.queue.push({ priority, resolve, reject, execute, enqueuedAt: Date.now(), timeoutMs });
      this.queue.sort((a, b) => a.priority - b.priority);
    });
  }

  private async processNext(): Promise<void> {
    const now = Date.now();
    this.queue = this.queue.filter(entry => {
      if (now - entry.enqueuedAt > entry.timeoutMs) {
        entry.resolve(QUEUE_TIMEOUT_MESSAGE);
        return false;
      }
      return true;
    });

    if (this.queue.length === 0) return;

    const next = this.queue.shift()!;
    this.running = true;

    try {
      const result = await next.execute();
      next.resolve(result);
    } catch (err) {
      next.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.running = false;
      this.processNext();
    }
  }
}
