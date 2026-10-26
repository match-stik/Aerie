// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Whether the house still has a GIF Lab working session. The GIF Lab and Cutout
// both keep their pictures in one on the house, and the sweep clears a session
// nobody has touched for a week, so each asks this before putting back what it
// remembers. Asking also counts as touching it, which keeps a session in use alive.
import { apiFetch } from '../aerie';

/**
 * True only when the house says plainly that it no longer has the session. An
 * older backend answers this address with the app's own page, and a dropped
 * connection answers nothing, and neither is a reason to throw away what the owner left.
 */
export async function sessionIsGone(sessionId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/gif/session/${encodeURIComponent(sessionId)}`);
    if (res.status !== 404) return false;
    const body = await res.json().catch(() => null);
    return !!body && body.exists === false;
  } catch {
    return false;
  }
}

/** How many crops the house can still undo for a session; 0 when it cannot say. */
export async function cropsToUndo(sessionId: string): Promise<number> {
  try {
    const res = await apiFetch(`/api/gif/session/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return 0;
    const body = await res.json().catch(() => null);
    return body && typeof body.cropsToUndo === 'number' ? body.cropsToUndo : 0;
  } catch {
    return 0;
  }
}
