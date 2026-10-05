// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center — shared helpers

import crypto from 'crypto';
import { getDb } from '../db.js';
import { getAerieConfig } from '../../config.js';
import { todayLocal } from '../time.js';

export function today(): string {
  return todayLocal(getAerieConfig().identity.timezone);
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function resolvePetId(petId?: string, petName?: string): string | null {
  if (petId) return petId;
  if (!petName) return null;
  const row = getDb().prepare('SELECT id FROM pets WHERE LOWER(name) = LOWER(?)').get(petName) as { id: string } | undefined;
  return row?.id || null;
}

export function resolveListId(listId?: string, listName?: string): string | null {
  if (listId) return listId;
  if (!listName) return null;
  const row = getDb().prepare('SELECT id FROM lists WHERE LOWER(name) = LOWER(?)').get(listName) as { id: string } | undefined;
  return row?.id || null;
}

export function calculateNextDue(fromDate: string, frequency: string): string | null {
  const d = new Date(fromDate);
  switch (frequency) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
    case 'as_needed': return null;
    default: return null;
  }
  return d.toISOString().split('T')[0];
}
