// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Message debouncer — combines rapid messages from same user/channel

import type { Message } from 'discord.js';
import type { MessageBatch, QueuedMessage } from './types.js';
import { DISCORD_CONFIG } from './config.js';
import { sanitizeForJson } from './utils.js';

type BatchHandler = (batch: MessageBatch) => Promise<void>;

// discord.js cleanContent reduces custom emotes <a:name:id> to :name:,
// dropping the id needed to render the emote image. Put the raw tokens back:
// each token from the raw content replaces the first matching :name: in the
// cleaned string, in order, so duplicates line up.
function restoreEmoteTokens(raw: string, cleaned: string): string {
  const tokens = raw.match(/<a?:\w+:\d{17,20}>/g);
  if (!tokens) return cleaned;
  let result = cleaned;
  for (const token of tokens) {
    const name = token.slice(token.indexOf(':') + 1, token.lastIndexOf(':'));
    result = result.replace(`:${name}:`, token);
  }
  return result;
}

export class MessageDebouncer {
  private queues: Map<string, QueuedMessage[]> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private handler: BatchHandler | null = null;

  private getKey(message: Message): string {
    return `${message.channelId}:${message.author.id}`;
  }

  onBatch(handler: BatchHandler): void {
    this.handler = handler;
  }

  add(message: Message): void {
    const key = this.getKey(message);

    let queue = this.queues.get(key);
    if (!queue) {
      queue = [];
      this.queues.set(key, queue);
    }

    queue.push({ message, timestamp: Date.now() });

    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    if (this.shouldProcessImmediately(message)) {
      this.flush(key);
      return;
    }

    const timer = setTimeout(() => {
      this.flush(key);
    }, DISCORD_CONFIG.debounceMs);

    this.timers.set(key, timer);
  }

  private shouldProcessImmediately(message: Message): boolean {
    if (message.attachments.size > 0) return true;
    if (message.content.startsWith('/')) return true;
    const content = message.content.toLowerCase();
    if (content === 'send' || content === 'go' || content === 'done') return true;
    return false;
  }

  private async flush(key: string): Promise<void> {
    const queue = this.queues.get(key);
    const timer = this.timers.get(key);

    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }

    if (!queue || queue.length === 0) {
      this.queues.delete(key);
      return;
    }

    const messages = queue.map(q => q.message);
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];

    const batch: MessageBatch = {
      messages,
      channelId: firstMessage.channelId,
      userId: firstMessage.author.id,
      guildId: firstMessage.guildId,
      // cleanContent resolves <@id> mentions to @username (and channel/role
      // refs to names) so stored messages stay human-readable in the phone —
      // but it also reduces custom emotes <a:name:id> to :name:, losing the
      // id the phone needs to render the emote image off the Discord CDN, so
      // restore the raw tokens afterwards.
      combinedContent: sanitizeForJson(
        messages.map(m => restoreEmoteTokens(m.content, m.cleanContent || m.content)).join('\n'),
      ),
      firstMessage,
      lastMessage,
    };

    this.queues.delete(key);

    if (this.handler) {
      await this.handler(batch);
    }
  }

  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.queues.clear();
  }
}
