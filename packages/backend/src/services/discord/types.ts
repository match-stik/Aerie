// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Discord gateway types

import type { Message } from 'discord.js';
import type { OwnerMentionReason } from './owner-mention.js';

export interface QueuedMessage {
  message: Message;
  timestamp: number;
}

export interface MessageBatch {
  messages: Message[];
  channelId: string;
  userId: string;
  guildId: string | null;
  combinedContent: string;
  firstMessage: Message;
  lastMessage: Message;
  channelHistory?: string;
}

export interface PairingCode {
  code: string;
  userId: string;
  username?: string;
  channelId: string;
  createdAt: string;
  expiresAt: string;
}

export interface PreflightResult {
  allowed: boolean;
  reason: string;
  requiresPairing?: boolean;
  pairingCode?: string;
  /**
   * Not allowed to be ANSWERED, but still to be heard: store it, broadcast it,
   * leave it unread, and generate nothing. Two things set this: the
   * consecutive-bot cool-off, and a message about the owner that was not
   * addressed to us (see ownerMention). Every other denial is a door and
   * stays one.
   */
  deliver?: boolean;
  /**
   * Set alongside `deliver` when the message is ABOUT the owner rather than
   * to us, and says why: a reply to the owner, an @mention of the owner, or their name.
   * The gateway routes it to where the owner is reading and sends the owner a
   * notification. The cool-off never sets it.
   */
  ownerMention?: OwnerMentionReason;
}
