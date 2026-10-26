// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Statuses on the phone (the house's services/statuses.ts): each companion's own
// line and icon, and the one under the faces the three of them share. A status
// fades back to Home six hours after it was set (the owner's ask, Oct 26 2026); the house
// stops sending a faded one, and this drops one that fades while the app is open.
// The owner's (`owner`) has no until and stays until the owner changes it.
import { useEffect, useState } from 'react';
import type { StatusLine } from '../aerie/protocol';
import { apiFetch } from '../aerie';
import { setState } from '../aerie/store';

/** The status if it has not faded yet. */
export function liveStatus(line: StatusLine | null | undefined, now = Date.now()): StatusLine | null {
  if (!line || !line.text?.trim()) return null;
  if (line.until === null) return line;
  const until = Date.parse(line.until);
  return Number.isFinite(until) && until > now ? line : null;
}

/** The clock, a minute at a time, so a status that fades while the owner looks goes. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Ask the house for every status (the socket also sends them on connect and on change). */
export async function refreshStatuses(): Promise<void> {
  try {
    const res = await apiFetch('/api/statuses');
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('companions' in body)) return;
    setState({ statuses: { shared: body.shared ?? null, companions: body.companions ?? {}, owner: body.owner ?? null } });
  } catch {
    // The socket will bring them.
  }
}

/** Change one status: a companion's slug, 'shared', or 'owner' for the owner's. Empty text clears it. */
export async function saveStatus(who: string, text: string, icon: string | null): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/statuses/${encodeURIComponent(who)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, icon }),
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    if (body && typeof body === 'object' && 'companions' in body) {
      setState({ statuses: { shared: body.shared ?? null, companions: body.companions ?? {}, owner: body.owner ?? null } });
    }
    return true;
  } catch {
    return false;
  }
}
