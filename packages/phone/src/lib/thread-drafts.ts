// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// One unsent draft per thread, shared by every box that can answer that
// thread: the chat's own box and the companions widget on the home screen. What
// the owner starts in one is waiting in the other (the owner's ask, Oct 26 2026). The chat's box stays mounted behind the
// home screen, so a write here also tells any box already showing the thread.

export const DRAFT_KEY_PREFIX = 'aerie_draft_';
const EVENT = 'aerie:thread-draft';

export interface DraftChange { threadId: string; text: string; from: string }

export function readDraft(threadId: string | null | undefined): string {
  if (!threadId) return '';
  try {
    return localStorage.getItem(DRAFT_KEY_PREFIX + threadId) ?? '';
  } catch {
    return '';
  }
}

/** Keep a thread's draft and tell the other boxes; `from` names the writer so it can ignore its own. */
export function writeDraft(threadId: string | null | undefined, text: string, from: string): void {
  if (!threadId) return;
  try {
    if (text) localStorage.setItem(DRAFT_KEY_PREFIX + threadId, text);
    else localStorage.removeItem(DRAFT_KEY_PREFIX + threadId);
  } catch {
    /* storage full or unavailable: the box still works, it just forgets */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<DraftChange>(EVENT, { detail: { threadId, text, from } }));
  }
}

/** Hear another box change a draft. Returns the unsubscribe. */
export function onDraftChange(listener: (change: DraftChange) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => listener((e as CustomEvent<DraftChange>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
