// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Message TTS cache
// Migrated from ../db.ts

import { getDb } from './state.js';

export interface MessageTts {
  message_id: string;
  file_id: string;
  voice_used: string | null;
  created_at: string;
}

export function getMessageTts(messageId: string): MessageTts | null {
  const stmt = getDb().prepare('SELECT * FROM message_tts WHERE message_id = ?');
  const row = stmt.get(messageId) as MessageTts | undefined;
  return row ?? null;
}

export function insertMessageTts(params: {
  messageId: string;
  fileId: string;
  voiceUsed: string;
  createdAt: string;
}): void {
  const stmt = getDb().prepare(`
    INSERT INTO message_tts (message_id, file_id, voice_used, created_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(params.messageId, params.fileId, params.voiceUsed, params.createdAt);
}

export function clearMessageTts(messageId?: string): number {
  const db = getDb();
  if (messageId) {
    const res = db.prepare('DELETE FROM message_tts WHERE message_id = ?').run(messageId);
    return res.changes;
  }
  const res = db.prepare('DELETE FROM message_tts').run();
  return res.changes;
}
