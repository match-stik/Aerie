// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
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
