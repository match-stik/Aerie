// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// DiscordService — Gateway listener that routes Discord messages through AgentService

import {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
  AttachmentBuilder,
} from 'discord.js';
import type { Message as DiscordMessage, TextChannel } from 'discord.js';
import { composeIncomingContent, stickerTokensFor } from './sticker-content.js';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { PROJECT_ROOT } from '../../config.js';
import crypto from 'crypto';
import { MessageDebouncer } from './debouncer.js';
import { preflight, mentionsBot } from './preflight.js';
import { PairingService } from './pairing.js';
import { getUserRule } from './rules.js';
import { discordTurnAudience } from '../turn-audience.js';
import { buildRulesContext } from './rules.js';
import { DISCORD_CONFIG, getDiscordConfig } from './config.js';
import { splitResponse, formatChannelHistory, getDiscordThreadId, fenceUntrustedTranscript } from './utils.js';
import type { MessageBatch } from './types.js';
import type { AgentService } from '../agent.js';
import { createMessage, createThread, getThread, getMostRecentActiveThread, updateThreadActivity } from '../db.js';
import { getAerieConfig } from '../../config.js';
import type { registry as registryInstance } from '../ws/connection-registry.js';
import { urlsToImageBlocks, capImageBlocks, type ImageBlock } from '../visual-blocks.js';
import { getSecret } from '../secrets.js';

const FILES_DIR = join(PROJECT_ROOT, 'data/files');
const ATTACH_MARKER_REGEX = /\[discord-attach:([a-f0-9-]+)\]/gi;

/** What the server actually calls this person: nickname > global name > username. */
function displayNameOf(message: DiscordMessage): string {
  return message.member?.displayName || message.author.displayName || message.author.username;
}

interface ParsedAttachments {
  text: string;
  files: AttachmentBuilder[];
}

function parseAttachmentMarkers(response: string): ParsedAttachments {
  const files: AttachmentBuilder[] = [];
  const matches = [...response.matchAll(ATTACH_MARKER_REGEX)];

  for (const match of matches) {
    const fileId = match[1];
    // Find the file in data/files/ (could be any extension)
    try {
      const dirContents = readdirSync(FILES_DIR);
      const matchingFile = dirContents.find(f => f.startsWith(fileId));
      if (matchingFile) {
        const filePath = join(FILES_DIR, matchingFile);
        if (existsSync(filePath)) {
          const buffer = readFileSync(filePath);
          files.push(new AttachmentBuilder(buffer, { name: matchingFile }));
          console.log(`[Discord] Attached file: ${matchingFile}`);
        }
      }
    } catch (err) {
      console.error(`[Discord] Failed to attach file ${fileId}:`, err);
    }
  }

  // Strip markers from text
  const text = response.replace(ATTACH_MARKER_REGEX, '').trim();

  return { text, files };
}

type ConnectionRegistry = typeof registryInstance;

// Module-level activity tracker — records last message per Discord user
interface ActivityEntry {
  name: string;
  lastSeen: number;
  channelId: string;
}

const recentActivity = new Map<string, ActivityEntry>();

export function getDiscordActivity(): Map<string, ActivityEntry> {
  return recentActivity;
}

// Channel → Thread routing cache — when owner sends from a Discord channel,
// record which Aerie thread they were routed to so replies from others follow
interface ChannelRouting {
  threadId: string;
  threadName: string;
  routedAt: number;
}

const channelRoutingCache = new Map<string, ChannelRouting>();
const ROUTING_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function setChannelRouting(channelId: string, threadId: string, threadName: string): void {
  channelRoutingCache.set(channelId, { threadId, threadName, routedAt: Date.now() });
}

function getChannelRouting(channelId: string): ChannelRouting | null {
  const entry = channelRoutingCache.get(channelId);
  if (!entry) return null;
  // Expire old entries
  if (Date.now() - entry.routedAt > ROUTING_CACHE_TTL_MS) {
    channelRoutingCache.delete(channelId);
    return null;
  }
  return entry;
}

export class DiscordService {
  private client: Client;
  private debouncer: MessageDebouncer;
  private pairingService: PairingService;
  private agentService: AgentService;
  private registry: ConnectionRegistry;
  private processing = new Set<string>();
  private started = false;

  // Deferred queue — holds non-owner Discord batches when owner is active on web UI
  private deferredBatches: Array<{ batch: MessageBatch; queuedAt: number }> = [];
  private deferTimer: ReturnType<typeof setInterval> | null = null;

  // Stats
  private stats = {
    messagesReceived: 0,
    messagesProcessed: 0,
    deferred: 0,
    errors: 0,
    startedAt: Date.now(),
  };

  constructor(agentService: AgentService, registry: ConnectionRegistry) {
    this.agentService = agentService;
    this.registry = registry;
    this.pairingService = new PairingService();

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [
        Partials.Channel,
        Partials.Message,
      ],
    });

    this.debouncer = new MessageDebouncer();
    this.debouncer.onBatch(this.handleBatch.bind(this));

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on(Events.MessageCreate, (message: DiscordMessage) => {
      // Ignore own messages
      if (message.author.id === this.client.user?.id) return;

      // Ignore unknown bots — allow bots with UserRules
      if (message.author.bot) {
        const botRule = getUserRule(message.author.id);
        if (!botRule) return;
        console.log(`[Discord] Known bot message: ${botRule.name}`);
      }

      this.stats.messagesReceived++;
      this.debouncer.add(message);
    });

    this.client.on(Events.ClientReady, (c) => {
      console.log(`[Discord] Logged in as ${c.user.tag}`);
      console.log(`[Discord] Guilds: ${c.guilds.cache.size}`);
    });

    this.client.on('error', (error) => {
      console.error('[Discord] Client error:', error);
    });

    this.client.on('warn', (msg) => {
      console.warn('[Discord] Warning:', msg);
    });

    this.client.on(Events.ShardDisconnect, (event, shardId) => {
      console.error(`[Discord] Shard ${shardId} disconnected (code ${event.code})`);
    });

    this.client.on(Events.ShardReconnecting, (shardId) => {
      console.log(`[Discord] Shard ${shardId} reconnecting...`);
    });

    this.client.on(Events.ShardResume, (shardId, replayedEvents) => {
      console.log(`[Discord] Shard ${shardId} resumed (${replayedEvents} events replayed)`);
    });
  }

  private async handleBatch(batch: MessageBatch): Promise<void> {
    const { firstMessage, lastMessage, channelId, userId } = batch;
    const isOwner = userId === DISCORD_CONFIG.ownerUserId;

    // Defer non-owner Discord messages when owner is actively chatting on web UI
    // This prevents Discord conversations from interrupting the owner's flow
    // Uses web-specific activity — Telegram activity should NOT trigger deferral
    if (!isOwner) {
      const ownerActiveMinutes = this.registry.minutesSinceLastUserWebActivity();
      if (ownerActiveMinutes < getDiscordConfig().ownerActiveThresholdMin) {
        this.deferredBatches.push({ batch, queuedAt: Date.now() });
        this.stats.deferred++;
        lastMessage.react('\u23F3').catch(() => {}); // hourglass — message seen but delayed
        console.log(`[Discord] Deferred message from ${firstMessage.author.username} (owner active ${ownerActiveMinutes.toFixed(1)}m ago, ${this.deferredBatches.length} in queue)`);
        return;
      }
    }

    await this._processBatch(batch);
  }

  private async _processBatch(batch: MessageBatch): Promise<void> {
    const { firstMessage, lastMessage, channelId, userId } = batch;
    const isOwner = userId === DISCORD_CONFIG.ownerUserId;
    const key = `${channelId}:${userId}`;

    if (this.processing.has(key)) {
      console.log(`[Discord] Already processing ${key}, skipping`);
      return;
    }

    this.processing.add(key);

    // Track activity for relational field context
    recentActivity.set(userId, {
      name: displayNameOf(firstMessage),
      lastSeen: Date.now(),
      channelId,
    });

    let typingInterval: ReturnType<typeof setInterval> | null = null;

    try {
      // Run preflight checks
      const result = await preflight(batch, this.pairingService);

      // Two shapes of no. A plain denial is a door and nothing comes through
      // it. `deliver` is the cool-off: we are not going to answer, and the
      // message still lands in the room, unread, exactly where the owner reads it.
      // It falls through the whole routing block below on purpose — the thread
      // a guest's words belong in is not a second question just because we are
      // being quiet — and stops at the line before generation.
      const heardOnly = !result.allowed && result.deliver === true;

      if (!result.allowed && !heardOnly) {
        console.log(`[Discord] Preflight denied: ${result.reason}`);

        if (result.requiresPairing && result.pairingCode) {
          const config = getAerieConfig();
          await lastMessage.reply(
            `I don't recognize you yet. To chat with me, ask ${config.identity.user_name} to approve this code: \`${result.pairingCode}\`\n\nThis code expires in 1 hour.`
          );
        }
        return;
      }

      if (heardOnly) console.log(`[Discord] Heard, not answering: ${result.reason}`);

      // Touch owner's activity if they're the sender
      if (isOwner) {
        this.registry.touchUserActivity();
      }

      // Show typing indicator (refresh every 8s — Discord typing expires after 10s).
      // Never while held: a typing dot is a promise of a reply that is not coming.
      if (!heardOnly) {
        if ('sendTyping' in lastMessage.channel) {
          await lastMessage.channel.sendTyping();
        }
        typingInterval = setInterval(() => {
          if ('sendTyping' in lastMessage.channel) {
            (lastMessage.channel as TextChannel).sendTyping().catch(() => {});
          }
        }, 8000);
      }

      console.log(`[Discord] Processing from ${firstMessage.author.username} in ${channelId}`);

      // Pre-fetch channel history (configurable limit, default 10). Skipped
      // while held — it only ever feeds a prompt, and there is no prompt.
      try {
        const channel = lastMessage.channel;
        if (!heardOnly && 'messages' in channel) {
          const historyLimit = getAerieConfig().discord.history_limit || 10;
          const history = await (channel as TextChannel).messages.fetch({ limit: historyLimit });
          batch.channelHistory = formatChannelHistory([...history.values()].reverse());
        }
      } catch (err) {
        console.warn('[Discord] Could not fetch channel history:', err);
      }

      // Resolve thread — owner routes to their active web session, others get channel-mapped threads
      let threadId: string;
      let threadName: string;

      if (isOwner) {
        // Owner's messages go to their most recently active web thread
        // This gives the companion full context from the web conversation
        const activeThread = getMostRecentActiveThread();
        if (activeThread) {
          threadId = activeThread.id;
          threadName = activeThread.name;
          // Cache this routing so replies from others in this channel follow
          setChannelRouting(channelId, threadId, threadName);
          console.log(`[Discord] Owner routed to active web thread: ${threadName} (${threadId})`);
        } else {
          // No active web thread — fall back to channel-mapped thread
          threadId = getDiscordThreadId(channelId);
          threadName = batch.guildId
            ? `#${(this.client.channels.cache.get(channelId) as TextChannel)?.name || channelId} (${this.client.guilds.cache.get(batch.guildId)?.name || batch.guildId})`
            : `DM: ${firstMessage.author.username}`;
          console.log(`[Discord] No active web thread — owner using Discord thread: ${threadName}`);
        }
      } else {
        // Non-owner: check cached routing first, then @mention/reply fallback to active thread
        const cachedRouting = getChannelRouting(channelId);
        if (cachedRouting) {
          threadId = cachedRouting.threadId;
          threadName = cachedRouting.threadName;
          console.log(`[Discord] Non-owner following cached routing to: ${threadName} (${threadId})`);
        } else if (mentionsBot(firstMessage)) {
          // @mention or reply to bot — route to owner's active thread if one exists
          const activeThread = getMostRecentActiveThread();
          if (activeThread) {
            threadId = activeThread.id;
            threadName = activeThread.name;
            console.log(`[Discord] Non-owner @mention/reply routed to owner's active thread: ${threadName} (${threadId})`);
          } else {
            // No active thread — fall through to channel-mapped
            threadId = getDiscordThreadId(channelId);
            if (batch.guildId) {
              const guild = this.client.guilds.cache.get(batch.guildId);
              const channel = this.client.channels.cache.get(channelId);
              const channelName = channel && 'name' in channel ? (channel as TextChannel).name : channelId;
              const guildName = guild?.name || batch.guildId;
              threadName = `#${channelName} (${guildName})`;
            } else {
              threadName = `DM: ${firstMessage.author.username}`;
            }
            console.log(`[Discord] Non-owner @mention but no active thread — using channel-mapped: ${threadName}`);
          }
        } else {
          // No cached routing, no @mention — use deterministic channel-mapped thread
          threadId = getDiscordThreadId(channelId);
          if (batch.guildId) {
            const guild = this.client.guilds.cache.get(batch.guildId);
            const channel = this.client.channels.cache.get(channelId);
            const channelName = channel && 'name' in channel ? (channel as TextChannel).name : channelId;
            const guildName = guild?.name || batch.guildId;
            threadName = `#${channelName} (${guildName})`;
          } else {
            threadName = `DM: ${firstMessage.author.username}`;
          }
          console.log(`[Discord] Non-owner using channel-mapped thread: ${threadName}`);
        }
      }

      // Ensure thread exists in SQLite
      let thread = getThread(threadId);
      if (!thread) {
        thread = createThread({
          id: threadId,
          name: threadName,
          type: 'named',
          createdAt: new Date().toISOString(),
          sessionType: 'v1',
        });
        console.log(`[Discord] Created thread: ${threadName} (${threadId})`);
      }

      // Store incoming message in SQLite
      const now = new Date().toISOString();
      const senderRole = isOwner ? 'user' : 'system';
      // Discord stickers ride a separate message field, not content — append
      // tokens the phone unfolds into inline images (Lottie has no image form).
      // ONE value: this is both what the row stores and what the prompt is
      // handed, so a sticker's name can never again reach the phone and miss us.
      const stickerTokens = stickerTokensFor(batch.messages);
      const storedContent = composeIncomingContent(batch.combinedContent, stickerTokens);
      const incomingMsg = createMessage({
        id: crypto.randomUUID(),
        threadId,
        role: senderRole as 'user' | 'system',
        content: storedContent,
        contentType: 'text',
        platform: 'discord',
        metadata: {
          discordUserId: userId,
          discordUsername: firstMessage.author.username,
          discordDisplayName: displayNameOf(firstMessage),
          // Their face, caught on the way in — the phone draws it on the guest
          // avatar rail instead of a letter in a circle. Member first so a
          // server-specific avatar wins, which is what the owner sees in Discord;
          // author is the fallback and always answers, even for someone who
          // has never set one (Discord serves its own default at that URL).
          // Stored per message on purpose: change your avatar and the next
          // thing you say arrives wearing it.
          discordAvatarUrl:
            firstMessage.member?.displayAvatarURL({ size: 128 }) ??
            firstMessage.author.displayAvatarURL({ size: 128 }),
          discordChannelId: channelId,
          discordGuildId: batch.guildId,
          discordMessageId: lastMessage.id,
        },
        createdAt: now,
      });

      updateThreadActivity(threadId, now, true);
      this.registry.broadcast({ type: 'message', message: incomingMsg });

      // The cool-off ends here. Stored, broadcast, unread — everything except
      // the answer. Nothing below this line runs, and the counter and the
      // clock are both deliberately untouched: the window is measured from our
      // last ANSWER, so the room reopens on time however long they keep talking.
      if (heardOnly) return;

      // Build platform context (platform info + rules + channel history)
      const platformHeader = batch.guildId
        ? `=== PLATFORM: DISCORD ===\nResponding in #${(this.client.channels.cache.get(channelId) as TextChannel)?.name || channelId} on ${this.client.guilds.cache.get(batch.guildId)?.name || batch.guildId}.`
        : `=== PLATFORM: DISCORD ===\nResponding in DM with ${firstMessage.author.username}.`;
      const platformGuidance = [
        platformHeader,
        'Discord formatting: **bold**, *italic*, `code`, ```codeblocks```, > quotes, ||spoilers||.',
        'Max message length: 2000 chars (responses auto-split at 1900).',
        'Replying to the last message in this batch.',
        'Keep responses appropriate to the platform — not as terse as Telegram, but don\'t write essays.',
        'IMPORTANT: Do NOT use --- (horizontal rules) between companion sections — they render as literal dashes in Discord. Use a blank line instead.',
        'A <dsticker:name:id.png> in an incoming message is a STICKER somebody sent — the part after dsticker: is its name, and that is what they said. Never write one yourself; Discord renders it as literal text.',
        'IMPORTANT: Voice headers keep the ENTIRE header inside the bold, on its own line — **🔥 Ivy**, never 🔥 **Ivy** — the phone splits bubbles and assigns avatars only on the bold-wrapped shape.',
      ].join('\n');

      const rulesContext = buildRulesContext(userId, channelId, batch.guildId);
      // The channel transcript is other people's words and rides inside the
      // owner's own full-tool turn, so it is fenced as untrusted data rather
      // than pasted in as plain context. See fenceUntrustedTranscript.
      const historyContext = batch.channelHistory
        ? `\n\n${fenceUntrustedTranscript(batch.channelHistory)}`
        : '';
      const platformContext = `${platformGuidance}\n\n${rulesContext}${historyContext}`;

      // Extract image attachment URLs from batch messages
      const imageUrls: string[] = [];
      const DISCORD_CDN = 'https://cdn.discordapp.com';
      const EMOTE_REGEX = /<(a?):(\w+):(\d+)>/g;

      for (const msg of batch.messages) {
        // Image attachments
        for (const att of msg.attachments.values()) {
          const contentType = att.contentType || '';
          if (contentType.startsWith('image/')) {
            imageUrls.push(att.url);
          }
        }

        // Embed images (GIFs, thumbnails)
        for (const embed of msg.embeds) {
          if (embed.image?.url) imageUrls.push(embed.image.url);
          else if (embed.thumbnail?.url) imageUrls.push(embed.thumbnail.url);
        }

        // Custom emotes from message content (<:name:id> or <a:name:id>)
        let emoteMatch;
        EMOTE_REGEX.lastIndex = 0;
        while ((emoteMatch = EMOTE_REGEX.exec(msg.content)) !== null) {
          const [, animated, , id] = emoteMatch;
          const ext = animated === 'a' ? 'gif' : 'png';
          imageUrls.push(`${DISCORD_CDN}/emojis/${id}.${ext}?size=128`);
        }

        // Stickers
        for (const sticker of msg.stickers.values()) {
          // Discord sticker formats: 1=PNG, 2=APNG, 3=LOTTIE (skip), 4=GIF
          if (sticker.format === 3) continue; // Lottie not supported as image
          const ext = sticker.format === 4 ? 'gif' : 'png';
          imageUrls.push(`${DISCORD_CDN}/stickers/${sticker.id}.${ext}?size=320`);
        }
      }

      // Fetch images and convert to blocks for the agent to see
      let imageBlocks: ImageBlock[] = [];
      if (imageUrls.length > 0) {
        console.log(`[Discord] Fetching ${imageUrls.length} image(s) for vision`);
        const fetched = await urlsToImageBlocks(imageUrls);
        const { kept, dropped } = capImageBlocks(fetched);
        imageBlocks = kept;
        if (dropped > 0) {
          console.log(`[Discord] Capped images: kept ${kept.length}, dropped ${dropped}`);
        }
      }

      this.stats.messagesProcessed++;

      // Process through AgentService
      const response = await this.agentService.processMessage(
        threadId,
        storedContent,
        { name: threadName, type: 'named' },
        {
          platform: 'discord',
          platformContext,
          imageBlocks: imageBlocks.length > 0 ? imageBlocks : undefined,
          discordAuthor: displayNameOf(firstMessage),
          inboundSequence: incomingMsg.sequence,
          // Who is asking, so the lane's tool gate can tell a guest's turn
          // from the owner's. A batch is one author (the debouncer keys on
          // channel and author), so one audience covers the whole turn.
          audience: discordTurnAudience(isOwner, getUserRule(userId)?.trustLevel),
        },
      );

      if (!response || response.trim() === '' || response === '[No response]') {
        console.log('[Discord] Empty response from agent');
        return;
      }

      // Parse for attachment markers and split response
      const { text: cleanedResponse, files: attachments } = parseAttachmentMarkers(response);

      // Handle attachment-only messages (no text content after stripping markers)
      if (!cleanedResponse || cleanedResponse.trim() === '') {
        if (attachments.length > 0) {
          await lastMessage.reply({ files: attachments });
          console.log(`[Discord] Sent ${attachments.length} attachment(s) (no text) to ${channelId}`);
        } else {
          console.log('[Discord] Empty response after parsing');
        }
        return;
      }

      const chunks = splitResponse(cleanedResponse, 1900);

      for (let i = 0; i < chunks.length; i++) {
        if (i === 0) {
          // First chunk gets any attachments
          if (attachments.length > 0) {
            await lastMessage.reply({ content: chunks[i], files: attachments });
          } else {
            await lastMessage.reply(chunks[i]);
          }
        } else {
          // 200ms delay between chunks to avoid rate limits
          await new Promise(r => setTimeout(r, 200));
          if ('send' in lastMessage.channel) {
            await (lastMessage.channel as TextChannel).send(chunks[i]);
          }
        }
      }

      console.log(`[Discord] Sent ${chunks.length} chunk(s)${attachments.length > 0 ? ` with ${attachments.length} attachment(s)` : ''} to ${channelId}`);

    } catch (error) {
      console.error('[Discord] Handler error:', error);
      this.stats.errors++;
    } finally {
      if (typingInterval) clearInterval(typingInterval);
      this.processing.delete(key);
    }
  }

  private async drainDeferredQueue(): Promise<void> {
    if (this.deferredBatches.length === 0) return;

    const config = getDiscordConfig();
    const ownerActiveMinutes = this.registry.minutesSinceLastUserWebActivity();
    if (ownerActiveMinutes < config.ownerActiveThresholdMin) return; // Owner still active on web — keep holding

    // Prune expired batches
    const now = Date.now();
    this.deferredBatches = this.deferredBatches.filter(entry => {
      if (now - entry.queuedAt > config.deferMaxAgeMs) {
        console.log(`[Discord] Dropping expired deferred batch from ${entry.batch.firstMessage.author.username}`);
        return false;
      }
      return true;
    });

    if (this.deferredBatches.length === 0) return;

    console.log(`[Discord] Owner idle ${ownerActiveMinutes.toFixed(1)}m — draining ${this.deferredBatches.length} deferred messages`);

    // Process one at a time to avoid flooding
    while (this.deferredBatches.length > 0) {
      // Re-check owner's web activity before each batch — stop draining if they come back to web
      if (this.registry.minutesSinceLastUserWebActivity() < config.ownerActiveThresholdMin) {
        console.log(`[Discord] Owner returned — pausing drain (${this.deferredBatches.length} remaining)`);
        break;
      }
      const entry = this.deferredBatches.shift()!;
      await this._processBatch(entry.batch);
    }
  }

  async start(): Promise<void> {
    const token = getSecret('discord_bot_token');
    if (!token) {
      console.error('[Discord] discord_bot_token not set — gateway disabled');
      return;
    }

    try {
      await this.client.login(token);
      this.started = true;

      // Start deferred queue drain timer
      this.deferTimer = setInterval(() => {
        this.drainDeferredQueue().catch(err =>
          console.error('[Discord] Drain error:', err)
        );
      }, getDiscordConfig().deferPollIntervalMs);

      console.log('[Discord] Gateway started');
    } catch (error) {
      console.error('[Discord] Failed to login:', error);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    console.log('[Discord] Shutting down gateway...');
    if (this.deferTimer) {
      clearInterval(this.deferTimer);
      this.deferTimer = null;
    }
    this.deferredBatches = [];
    this.debouncer.destroy();
    this.client.destroy();
    this.started = false;
  }

  isConnected(): boolean {
    return this.started && this.client.isReady();
  }

  getStats() {
    return {
      ...this.stats,
      deferredPending: this.deferredBatches.length,
      connected: this.isConnected(),
      username: this.client.user?.username || null,
      guilds: this.client.guilds.cache.size,
    };
  }

  getPairingService(): PairingService {
    return this.pairingService;
  }
}
