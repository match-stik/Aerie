// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Discord gateway types

import type { Message } from 'discord.js';

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
   * leave it unread, and generate nothing. Only the consecutive-bot cool-off
   * sets this — every other denial is a door and stays one.
   */
  deliver?: boolean;
}
