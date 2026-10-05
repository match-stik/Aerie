// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// SQLite-backed pairing system for Discord user approval

import { getDb } from '../db.js';
import { getAerieConfig } from '../../config.js';
import type { PairingCode } from './types.js';

export class PairingService {
  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  createOrGet(userId: string, username: string, channelId: string): string {
    const db = getDb();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

    // Check for existing valid code
    const existing = db.prepare(`
      SELECT code FROM discord_pairings
      WHERE user_id = ? AND approved_at IS NULL AND expires_at > ?
    `).get(userId, now.toISOString()) as { code: string } | undefined;

    if (existing) return existing.code;

    // Generate new code
    const code = this.generateCode();
    db.prepare(`
      INSERT INTO discord_pairings (code, user_id, username, channel_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(code, userId, username, channelId, now.toISOString(), expiresAt.toISOString());

    return code;
  }

  isApproved(userId: string): boolean {
    const db = getDb();
    const row = db.prepare(`
      SELECT 1 FROM discord_pairings
      WHERE user_id = ? AND approved_at IS NOT NULL
      LIMIT 1
    `).get(userId);
    return !!row;
  }

  approve(code: string, approvedBy?: string): { success: boolean; userId?: string; error?: string } {
    const db = getDb();
    const config = getAerieConfig();
    const now = new Date().toISOString();
    const approver = approvedBy || config.identity.user_name;

    // Columns are aliased to the camelCase the type promises. SQLite hands rows
    // back in the table's own snake_case, and reading expires_at as expiresAt
    // meant an expired code was never refused and the approval named no user.
    const pairing = db.prepare(`
      SELECT code, user_id AS userId, username, channel_id AS channelId,
             created_at AS createdAt, expires_at AS expiresAt
      FROM discord_pairings
      WHERE code = ? AND approved_at IS NULL
    `).get(code.toUpperCase()) as PairingCode | undefined;

    if (!pairing) {
      return { success: false, error: 'Invalid or already approved code' };
    }

    if (!(pairing.expiresAt > now)) {
      db.prepare('DELETE FROM discord_pairings WHERE code = ?').run(code.toUpperCase());
      return { success: false, error: 'Code has expired' };
    }

    db.prepare(`
      UPDATE discord_pairings SET approved_at = ?, approved_by = ?
      WHERE code = ?
    `).run(now, approver, code.toUpperCase());

    return { success: true, userId: pairing.userId };
  }

  revoke(userId: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM discord_pairings WHERE user_id = ?').run(userId);
    return result.changes > 0;
  }

  listPending(): PairingCode[] {
    const db = getDb();
    const now = new Date().toISOString();
    // Clean expired
    db.prepare('DELETE FROM discord_pairings WHERE approved_at IS NULL AND expires_at < ?').run(now);
    return db.prepare(`
      SELECT code, user_id AS userId, username, channel_id AS channelId,
             created_at AS createdAt, expires_at AS expiresAt
      FROM discord_pairings WHERE approved_at IS NULL ORDER BY created_at DESC
    `).all() as unknown as PairingCode[];
  }

  listApproved(): Array<{ userId: string; username: string | null; approvedAt: string }> {
    const db = getDb();
    return db.prepare(`
      SELECT user_id as userId, username, approved_at as approvedAt
      FROM discord_pairings WHERE approved_at IS NOT NULL
    `).all() as any[];
  }
}
