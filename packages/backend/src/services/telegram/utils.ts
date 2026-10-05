// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Telegram utility functions

import crypto from 'crypto';

/**
 * Split a response into Telegram-safe chunks (max 4096 chars).
 * Breaks at paragraph boundaries first, then line breaks, then spaces.
 */
export function splitResponse(text: string, maxLength = 4096): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to break at paragraph boundary
    let splitAt = remaining.lastIndexOf('\n\n', maxLength);
    if (splitAt === -1 || splitAt < maxLength * 0.3) {
      // Try line break
      splitAt = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitAt === -1 || splitAt < maxLength * 0.3) {
      // Try space
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt === -1 || splitAt < maxLength * 0.3) {
      // Hard cut
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Generate a deterministic thread ID for a Telegram chat.
 * Same chat always maps to the same thread.
 */
export function getTelegramThreadId(chatId: string): string {
  const hash = crypto.createHash('sha256').update(`telegram:${chatId}`).digest('hex');
  // Format as UUID v4-style
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}
