// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
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
import { parseAttachmentMarkers } from './attach-markers.js';
import crypto from 'crypto';
import { MessageDebouncer } from './debouncer.js';
import { preflight, mentionsBot, heldRoleNamesOf, heldPingGate, noteJudgedAnswer } from './preflight.js';
import { getPushService } from '../push.js';
import { PairingService } from './pairing.js';
import { getUserRule, requiresMention } from './rules.js';
import { discordTurnAudience } from '../turn-audience.js';
import { buildRulesContext } from './rules.js';
import { DISCORD_CONFIG, getDiscordConfig } from './config.js';
import { splitResponse, formatChannelHistory, getDiscordThreadId, fenceUntrustedTranscript } from './utils.js';
import { botLoopExhausted } from './bot-loop.js';
import {
  judgeCall,
  judgeInputOf,
  beatShouldWait,
  beatBanner,
  noteTyping,
  noteSpoke,
  latestTypingIn,
  BEAT_RECHECK_MS,
  type JudgeCall,
} from './judge.js';
import type { MessageBatch } from './types.js';
import { QUEUE_TIMEOUT_MESSAGE } from '../agent/agent-query-queue.js';
import type { AgentService } from '../agent.js';
import { createMessage, createThread, getThread, getMostRecentActiveThread, getMostRecentActiveThreadExcept, updateThreadActivity, listCompanions } from '../db.js';
import { getAerieConfig } from '../../config.js';
import type { registry as registryInstance } from '../ws/connection-registry.js';
import { urlsToImageBlocks, capImageBlocks, type ImageBlock } from '../visual-blocks.js';

import { getSecret } from '../secrets.js';
import { buildOwnerMentionPush } from './owner-mention.js';

/** Who a message of ours may ping. Users yes, roles and everyone never. */
export const DISCORD_ALLOWED_MENTIONS = { parse: ['users'] as const, repliedUser: true };

/** What the server actually calls this person: nickname > global name > username. */
function displayNameOf(message: DiscordMessage): string {
  return message.member?.displayName || message.author.displayName || message.author.username;
}

/** A Discord object's display name, when it has a real one. */
function nameOf(thing: unknown): string | undefined {
  const name = (thing as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && name ? name : undefined;
}

type ConnectionRegistry = typeof registryInstance;

/** Our names as words a message can carry (the judge's "one of our names"). */
function companionNames(): string[] {
  try {
    return listCompanions().flatMap((c) => [c.display_name, c.slug]).filter(Boolean);
  } catch {
    return [];
  }
}

/** Everything a reply needs once the message it answers is stored. */
interface ReplyTurn {
  /** 'answer' now, or a beat that has run ('beat' may pass, 'share' answers). */
  kind: 'answer' | 'beat' | 'share';
  batch: MessageBatch;
  threadId: string;
  threadName: string;
  storedContent: string;
  incomingMsgId: string;
  incomingSequence: number;
  /** Set when a beat is up: we posted in this room after its message arrived. */
  spokeSinceOpen?: boolean;
  isOwner: boolean;
  userId: string;
  channelId: string;
}

/** A message said to the room, waiting for the beat (see judge.ts). */
interface PendingBeat {
  openedAt: number;
  turn: ReplyTurn;
  timer: ReturnType<typeof setTimeout>;
}

/** The query queue's own refusals, which are never words of ours. */
export function isQueueRefusal(response: string): boolean {
  const text = response.trim();
  return text === QUEUE_TIMEOUT_MESSAGE || /^\[.* is busy — please try again in a moment\]$/.test(text);
}

/**
 * Their home thread, as seen from a Discord room: the most recently active one,
 * never the room's own channel thread. Guests in a listening room keep that
 * thread newest, and the owner's messages were following it out of their own
 * (Oct 19 2026).
 * The room's thread is still the answer when it is the only thread there is.
 */
function homeThreadFrom(channelId: string) {
  const newest = getMostRecentActiveThread();
  if (newest && newest.id === getDiscordThreadId(channelId)) {
    return getMostRecentActiveThreadExcept(newest.id) ?? newest;
  }
  return newest;
}

/** What the log says when the judge keeps a message quiet. */
function judgeReason(call: JudgeCall): string {
  if (call === 'hear') return 'aimed at somebody else (the judge)';
  if (call === 'share') return 'tagged with somebody else, waiting a beat (the judge)';
  return 'said to the room, waiting a beat (the judge)';
}

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
  /** One open beat per room at most (see judge.ts). */
  private beats = new Map<string, PendingBeat>();
  /** When we last posted in each room, so a beat knows whether we already spoke after it opened. */
  private lastSpokeAt = new Map<string, number>();

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
      // Nothing we send can ping a whole server or a role: @everyone, @here
      // and <@&role> stay plain text. Tagging one person, and the person we
      // reply to, still works. Checked Oct 22 2026 against a guest's turn,
      // which could otherwise ask us to say @everyone in somebody's server.
      allowedMentions: DISCORD_ALLOWED_MENTIONS,
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        // Who is typing where: the judge's order (whoever started first goes
        // first). Not a privileged intent; nothing to switch on in the portal.
        GatewayIntentBits.GuildMessageTyping,
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
    this.client.on(Events.TypingStart, (typing) => {
      if (typing.user.id === this.client.user?.id) return;
      noteTyping(typing.channel.id, typing.user.id, typing.startedTimestamp);
    });

    this.client.on(Events.MessageCreate, (message: DiscordMessage) => {
      // Ignore own messages
      if (message.author.id === this.client.user?.id) return;

      // Whoever was typing has said it now, heard by us or not.
      noteSpoke(message.channelId, message.author.id);

      // Ignore unknown bots — allow bots with UserRules. The one exception is
      // a ping to a role we hold: that comes home to the owner as a note from anyone
      // (heldPingDecision), and a note is never an answer.
      if (message.author.bot) {
        const botRule = getUserRule(message.author.id);
        if (!botRule) {
          if (heldRoleNamesOf(message).length === 0) return;
          console.log(`[Discord] Unknown bot ${message.author.username} pinged a role we hold; holding it for the owner`);
        } else {
          console.log(`[Discord] Known bot message: ${botRule.name}`);
        }
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
      // A ping that reaches us only through a role is held for the owner: it lands
      // in their thread under a line saying who pinged which role where, the owner gets
      // a notification if the owner is not looking, and nobody answers in the
      // channel (see heldRoleNames). It comes home from anyone, so it skips the
      // trust fences in preflight and passes only heldPingGate. Their own
      // messages are never held.
      const heldRoles = isOwner ? [] : heldRoleNamesOf(firstMessage);
      const heldGate = heldRoles.length > 0 ? heldPingGate(batch) : null;
      if (heldGate && !heldGate.allowed) {
        console.log(`[Discord] Role ping not held: ${heldGate.reason}`);
        return;
      }
      const holdForHer = heldGate !== null;

      // The judge (judge.ts): in a room that needs no mention, a message that
      // is not ours waits for a beat or is only heard. Their own messages, a DM
      // and a held ping are never sorted, and come back 'answer'.
      const judgeConfig = getDiscordConfig();
      const judged: JudgeCall = holdForHer
        ? 'answer'
        : judgeCall(await judgeInputOf(batch.messages, {
            enabled: judgeConfig.judgeEnabled,
            isOwner,
            mentionRequired: requiresMention(channelId, batch.guildId, judgeConfig.requireMentionInGuilds),
            names: companionNames(),
          }));

      // Run preflight checks (a held ping never asks them; it is not a turn).
      // A bot turn the judge is holding is not counted yet (see preflight).
      const result = holdForHer
        ? { allowed: true, reason: heldGate.reason }
        : await preflight(batch, this.pairingService, { countBotTurn: judged === 'answer' });

      // Two shapes of no. A plain denial is a door and nothing comes through
      // it. `deliver` is the cool-off: we are not going to answer, and the
      // message still lands in the room, unread, exactly where the owner reads it.
      // It falls through the whole routing block below on purpose — the thread
      // a guest's words belong in is not a second question just because we are
      // being quiet — and stops at the line before generation.
      const cooledOff = !result.allowed && result.deliver === true;
      // The judge's quiet is the same shape: approved, stored, shown, and not
      // ours to answer now. Only ever on an approved message, so a denied one
      // can never come through it.
      const waiting = result.allowed && judged !== 'answer';
      const heardOnly = cooledOff || waiting;
      // The other kind of heard: a message ABOUT the owner that was not addressed to
      // us. It takes the cool-off's held path, and on the way it is routed to
      // where the owner is reading, labeled with why, and allowed to wake their phone.
      const ownerMention = cooledOff ? result.ownerMention : undefined;

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

      if (heardOnly) console.log(`[Discord] Heard, not answering: ${cooledOff ? result.reason : judgeReason(judged)}`);
      const quiet = heardOnly || holdForHer;

      // Something is being answered here now, so an open beat in this room
      // folds into it: this turn reads the same transcript the beat would have.
      if (!quiet) this.cancelBeat(channelId, `folded into the answer to ${firstMessage.author.username}`);

      // Touch owner's activity if they're the sender
      if (isOwner) {
        this.registry.touchUserActivity();
      }

      // Show typing indicator (refresh every 8s — Discord typing expires after 10s).
      // Never while held: a typing dot is a promise of a reply that is not coming.
      if (!quiet) {
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
        if (!quiet && 'messages' in channel) {
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
        const activeThread = homeThreadFrom(channelId);
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
        } else if (ownerMention || mentionsBot(firstMessage)) {
          // @mention or reply to bot — route to owner's active thread if one exists.
          // A message about the owner goes the same way, because the whole point of
          // delivering it is that it lands where the owner is reading.
          const why = ownerMention ? `message about the owner (${ownerMention})` : '@mention/reply';
          const activeThread = homeThreadFrom(channelId);
          if (activeThread) {
            threadId = activeThread.id;
            threadName = activeThread.name;
            console.log(`[Discord] Non-owner ${why} routed to owner's active thread: ${threadName} (${threadId})`);
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
            console.log(`[Discord] Non-owner ${why} but no active thread — using channel-mapped: ${threadName}`);
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

      // A held role ping goes to their thread, whatever this channel was routed to.
      if (holdForHer) {
        const home = homeThreadFrom(channelId);
        if (home) {
          threadId = home.id;
          threadName = home.name;
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

      // Where a message about the owner was said, in the names the owner would use for it:
      // read off the message itself first, then the client's caches, and the
      // raw id only when neither knows.
      const place = ownerMention
        ? {
            channelName: nameOf(lastMessage.channel) ?? nameOf(this.client.channels.cache.get(channelId)) ?? channelId,
            guildName: batch.guildId
              ? nameOf(lastMessage.guild) ?? nameOf(this.client.guilds.cache.get(batch.guildId)) ?? batch.guildId
              : null,
          }
        : null;

      // Store incoming message in SQLite
      const now = new Date().toISOString();

      // The line over a held role ping, in the middle like any system line,
      // so the owner can see why a guest is in their thread and that nobody answered.
      const heldRolesLabel = heldRoles.map((r) => `@${r}`).join(', ');
      const heldChannel = this.client.channels.cache.get(channelId);
      const heldChannelName = heldChannel && 'name' in heldChannel ? `#${(heldChannel as TextChannel).name}` : 'a channel';
      const heldGuildName = batch.guildId ? (this.client.guilds.cache.get(batch.guildId)?.name || '') : '';
      if (holdForHer) {
        const note = createMessage({
          id: crypto.randomUUID(),
          threadId,
          role: 'system',
          content: `Held for you: ${displayNameOf(firstMessage)} pinged ${heldRolesLabel} in ${heldChannelName}${heldGuildName ? ` (${heldGuildName})` : ''}. Nobody answered in the channel.`,
          contentType: 'text',
          metadata: {
            source: 'discord-role-ping',
            roles: heldRoles,
            discordChannelId: channelId,
            discordGuildId: batch.guildId,
            discordMessageId: lastMessage.id,
          },
          createdAt: now,
        });
        this.registry.broadcast({ type: 'message', message: note });
      }
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
          // Their reply to somebody else, heard and not ours: kept out of every
          // history our lanes read, so nothing comes back to answer it.
          ...(isOwner && waiting ? { judgeHeard: true } : {}),
          // A message about the owner rather than to us says so, and where it was
          // said, so the phone can label it without looking anything up.
          ...(ownerMention && place
            ? { ownerMention, discordChannelName: place.channelName, discordGuildName: place.guildName }
            : {}),
        },
        createdAt: now,
      });

      updateThreadActivity(threadId, now, true);
      this.registry.broadcast({ type: 'message', message: incomingMsg });

      // A message said to the room opens the beat (or joins one already open)
      // only now that it is stored and shown, the same order as every quiet
      // turn: their screen first.
      if (waiting && (judged === 'beat' || judged === 'share')) {
        this.openBeat({
          kind: judged,
          batch,
          threadId,
          threadName,
          storedContent,
          incomingMsgId: incomingMsg.id,
          incomingSequence: incomingMsg.sequence,
          isOwner,
          userId,
          channelId,
        });
      }

      // A message about the owner wakes their phone: the one kind of heard message
      // that does. Through sendIfOffline, so it stays quiet while the owner is already
      // looking at the app. Not awaited: a push is a network round trip, and
      // while this batch is still running, the next one from the same person
      // in the same channel is skipped as already processing.
      if (ownerMention && place) {
        const push = getPushService();
        if (push) {
          push.sendIfOffline(buildOwnerMentionPush({
            displayName: displayNameOf(firstMessage),
            reason: ownerMention,
            text: storedContent,
            channelName: place.channelName,
            threadId,
            channelId,
          })).catch(err => console.error('[Discord] Owner mention push error:', err));
        }
      }

      // The cool-off ends here, and so does a message about the owner. Stored,
      // broadcast, unread — everything except the answer. Nothing below this
      // line runs, and the counter and the clock are both deliberately
      // untouched: the window is measured from our last ANSWER, so the room
      // reopens on time however long they keep talking.
      if (heardOnly) return;

      // A held role ping stops here too: stored, broadcast, unread, and the owner's
      // phone told if the owner is not looking at it.
      if (holdForHer) {
        getPushService()?.sendIfOffline({
          title: displayNameOf(firstMessage),
          body: `Pinged ${heldRolesLabel} in ${heldChannelName}${heldGuildName ? ` (${heldGuildName})` : ''}`,
          threadId,
          tag: `role-ping-${lastMessage.id}`,
        }).catch((err) => console.warn('[Discord] Role ping push failed:', err));
        console.log(`[Discord] Held a role ping (${heldRolesLabel}) from ${firstMessage.author.username} for the owner: ${threadName}`);
        return;
      }

      await this.generateAndReply({
        kind: 'answer',
        batch,
        threadId,
        threadName,
        storedContent,
        incomingMsgId: incomingMsg.id,
        incomingSequence: incomingMsg.sequence,
        isOwner,
        userId,
        channelId,
      });

    } catch (error) {
      console.error('[Discord] Handler error:', error);
      this.stats.errors++;
    } finally {
      if (typingInterval) clearInterval(typingInterval);
      this.processing.delete(key);
    }
  }

  /**
   * Everything after the message is stored: the prompt, the turn, the reply in
   * the channel. An answer now comes here straight from _processBatch; a beat
   * comes here when it is up, with a fresh transcript and the beat's lines.
   */
  private async generateAndReply(turn: ReplyTurn): Promise<void> {
    const { batch, threadId, threadName, storedContent, isOwner, userId, channelId } = turn;
    const { firstMessage, lastMessage } = batch;

    // Build platform context (platform info + rules + channel history)
    const platformHeader = batch.guildId
      ? `=== PLATFORM: DISCORD ===\nResponding in #${(this.client.channels.cache.get(channelId) as TextChannel)?.name || channelId} on ${this.client.guilds.cache.get(batch.guildId)?.name || batch.guildId}.`
      : `=== PLATFORM: DISCORD ===\nResponding in DM with ${firstMessage.author.username}.`;
    const platformGuidance = [
      platformHeader,
      'Discord formatting: **bold**, *italic*, `code`, ```codeblocks```, > quotes, ||spoilers||.',
      'Max message length: 2000 chars (responses auto-split at 1900).',
      turn.kind === 'answer'
        ? 'Replying to the last message in this batch.'
        : 'Answering the room after a beat: the message below opened it, and the transcript holds everything said since.',
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
    const beatContext = turn.kind === 'answer' ? '' : `${beatBanner(turn.kind, turn.spokeSinceOpen)}\n\n`;
    const platformContext = `${platformGuidance}\n\n${beatContext}${rulesContext}${historyContext}`;

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
        inboundSequence: turn.incomingSequence,
        // Read checks on their own messages (a guest's are not theirs to tick).
        messageId: turn.incomingMsgId,
        // Who is asking, so the lane's tool gate can tell a guest's turn
        // from the owner's. A batch is one author (the debouncer keys on
        // channel and author), so one audience covers the whole turn.
        audience: discordTurnAudience(isOwner, getUserRule(userId)?.trustLevel),
      },
    );

    // The query queue answers a turn it gave up on with its own sentinel text
    // (and a full queue with a 'busy' line). Those are house plumbing, never a
    // reply: posted, they put '[Request timed out in queue]' in the cafe under
    // our name (Oct 19 2026, while a long build turn held the lane). Their own
    // message stays in their thread unanswered, where the missed net finds it.
    if (response && isQueueRefusal(response)) {
      console.warn(`[Discord] Not posting a queue refusal to ${channelId}: ${response.trim()}`);
      return;
    }

    if (!response || response.trim() === '' || response === '[No response]') {
      // On a beat that is the pass, chosen; anywhere else it is a turn that
      // came back with nothing.
      console.log(turn.kind === 'beat' || turn.spokeSinceOpen ? `[Discord] Beat passed in ${channelId}: nothing of ours to add` : '[Discord] Empty response from agent');
      return;
    }

    // Parse for attachment markers and split response
    const { text: cleanedResponse, files: attachments } = parseAttachmentMarkers(response);

    // Handle attachment-only messages (no text content after stripping markers)
    if (!cleanedResponse || cleanedResponse.trim() === '') {
      if (attachments.length > 0) {
        await this.replyOrSend(lastMessage, { files: attachments });
        console.log(`[Discord] Sent ${attachments.length} attachment(s) (no text) to ${channelId}`);
        this.lastSpokeAt.set(channelId, Date.now());
        if (turn.kind !== 'answer') noteJudgedAnswer(channelId, firstMessage.author.bot);
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
          await this.replyOrSend(lastMessage, { content: chunks[i], files: attachments });
        } else {
          await this.replyOrSend(lastMessage, chunks[i]);
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
    this.lastSpokeAt.set(channelId, Date.now());
    // A beat that answered has spent the bot turn it opened on (see preflight).
    if (turn.kind !== 'answer') noteJudgedAnswer(channelId, firstMessage.author.bot);
  }

  /**
   * Reply to the message, or say it to the room when that message is gone (a
   * beat answers a minute late, and people delete things).
   */
  private async replyOrSend(
    message: DiscordMessage,
    payload: string | { content?: string; files: AttachmentBuilder[] },
  ): Promise<void> {
    try {
      await message.reply(payload);
    } catch (err) {
      if (!('send' in message.channel)) throw err;
      console.warn(`[Discord] Could not reply to ${message.id}, saying it to the room instead:`, (err as Error).message);
      await (message.channel as TextChannel).send(payload);
    }
  }

  /**
   * A message said to the room waits here (judge.ts). One beat per room: a
   * later message joins the open one and is read in the transcript when it is
   * up, and a shared tag outranks a general message as the one we answer.
   */
  private openBeat(turn: ReplyTurn): void {
    const open = this.beats.get(turn.channelId);
    if (open) {
      if (turn.kind === 'share' && open.turn.kind !== 'share') open.turn = turn;
      console.log(`[Discord] ${turn.batch.firstMessage.author.username} joins the beat open in ${turn.channelId}`);
      return;
    }
    const beatMs = getDiscordConfig().judgeBeatMs;
    this.beats.set(turn.channelId, {
      openedAt: Date.now(),
      turn,
      timer: setTimeout(() => void this.fireBeat(turn.channelId), beatMs),
    });
    console.log(`[Discord] Beat opened in ${turn.channelId} (${turn.kind}, ${Math.round(beatMs / 1000)}s) for ${turn.batch.firstMessage.author.username}`);
  }

  private cancelBeat(channelId: string, why: string): void {
    const open = this.beats.get(channelId);
    if (!open) return;
    clearTimeout(open.timer);
    this.beats.delete(channelId);
    console.log(`[Discord] Beat in ${channelId} closed: ${why}`);
  }

  /**
   * The beat is up. It waits on while anybody else in the room is typing,
   * because they started first, then reads everything said since and hands
   * the room to the lane, which answers or passes. Never a typing dot: we may
   * well say nothing.
   */
  private async fireBeat(channelId: string): Promise<void> {
    const open = this.beats.get(channelId);
    if (!open) return;
    const now = Date.now();
    if (beatShouldWait({
      now,
      openedAt: open.openedAt,
      maxWaitMs: getDiscordConfig().judgeMaxWaitMs,
      lastOtherTypingAt: latestTypingIn(channelId, now),
    })) {
      open.timer = setTimeout(() => void this.fireBeat(channelId), BEAT_RECHECK_MS);
      return;
    }
    this.beats.delete(channelId);

    const { turn } = open;
    turn.spokeSinceOpen = (this.lastSpokeAt.get(channelId) ?? 0) > open.openedAt;
    if (turn.batch.firstMessage.author.bot && botLoopExhausted(channelId)) {
      console.log(`[Discord] Beat in ${channelId} ended quiet: the bot guard has this room`);
      return;
    }

    const key = `${channelId}:beat`;
    if (this.processing.has(key)) {
      console.log(`[Discord] A beat is already answering in ${channelId}, skipping`);
      return;
    }
    this.processing.add(key);
    try {
      try {
        const channel = turn.batch.lastMessage.channel;
        if ('messages' in channel) {
          // Fresh, and a little longer than usual: a minute of a busy room.
          const historyLimit = Math.max(getAerieConfig().discord.history_limit || 10, 15);
          const history = await (channel as TextChannel).messages.fetch({ limit: historyLimit });
          turn.batch.channelHistory = formatChannelHistory([...history.values()].reverse());
        }
      } catch (err) {
        console.warn('[Discord] Could not fetch channel history for the beat:', err);
      }
      console.log(`[Discord] Beat in ${channelId} is up after ${Math.round((Date.now() - open.openedAt) / 1000)}s; deciding`);
      await this.generateAndReply(turn);
    } catch (error) {
      console.error('[Discord] Beat error:', error);
      this.stats.errors++;
    } finally {
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
    for (const open of this.beats.values()) clearTimeout(open.timer);
    this.beats.clear();
    this.lastSpokeAt.clear();
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
