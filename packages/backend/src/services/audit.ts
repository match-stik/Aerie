// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import crypto from 'crypto';
import { getDb } from './db.js';

export function logToolUse(params: {
  sessionId: string;
  threadId: string;
  toolName: string;
  toolInput?: string;
  toolOutput?: string;
  triggeringMessageId?: string;
}): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO audit_log (id, session_id, thread_id, tool_name, tool_input, tool_output, triggering_message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    crypto.randomUUID(),
    params.sessionId,
    params.threadId,
    params.toolName,
    params.toolInput ? params.toolInput.substring(0, 5000) : null,
    params.toolOutput ? params.toolOutput.substring(0, 1000) : null,
    params.triggeringMessageId || null,
    new Date().toISOString()
  );
}

export function getRecentAuditEntries(limit = 50): Array<Record<string, unknown>> {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM audit_log
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit) as Array<Record<string, unknown>>;
}
