// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The thread list's decisions, kept apart from the switcher that draws them:
// what a room's preview says, and which group the room sits in.

import type { ThreadSummary } from '../aerie';

/**
 * A room's last line as text. The socket sends a preview as one string, and
 * GET /api/threads describes it as { content, role, created_at }; the phone's
 * ThreadSummary is the string. Archive, restore and rename all reload the list
 * over REST, so the switcher was handed objects, stripMarkdown threw on the
 * first one, and the whole screen went black.
 */
export function previewText(preview: unknown): string | null {
  const raw =
    typeof preview === 'string'
      ? preview
      : preview && typeof preview === 'object' && typeof (preview as { content?: unknown }).content === 'string'
        ? (preview as { content: string }).content
        : '';
  const text = raw.replace(/\n/g, ' ').trim();
  return text || null;
}

export function monthKey(dateStr: string | null, now = new Date()): string {
  const d = dateStr ? new Date(dateStr) : now;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function sameLocalDay(dateStr: string | null, now: Date): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return !Number.isNaN(d.getTime()) && d.toDateString() === now.toDateString();
}

export interface ThreadGroups {
  pinned: ThreadSummary[];
  today: ThreadSummary[];
  months: Array<[string, ThreadSummary[]]>;
  named: ThreadSummary[];
}

/**
 * Pinned rooms first, then Today, then the older dailies folded by month, then
 * the named rooms. Today holds the open daily and any daily whose last word was
 * today. It used to hold whichever daily was newest, which was right while a
 * daily was made every day; once a house moves into one long thread, an old
 * daily can stand under Today for months, and archiving it brings the
 * next-newest up in its place.
 */
export function groupThreads(threads: ThreadSummary[], activeThreadId: string | null, now = new Date()): ThreadGroups {
  const pinned = threads.filter((t) => t.pinned_at);
  pinned.sort((a, b) => ((a.pinned_at || '') > (b.pinned_at || '') ? 1 : -1));
  const pinnedIds = new Set(pinned.map((t) => t.id));

  const today: ThreadSummary[] = [];
  const named: ThreadSummary[] = [];
  const monthMap = new Map<string, ThreadSummary[]>();
  for (const t of threads) {
    if (pinnedIds.has(t.id)) continue;
    if (t.type !== 'daily') {
      named.push(t);
    } else if (t.id === activeThreadId || sameLocalDay(t.last_activity_at, now)) {
      today.push(t);
    } else {
      const key = monthKey(t.last_activity_at, now);
      if (!monthMap.has(key)) monthMap.set(key, []);
      monthMap.get(key)!.push(t);
    }
  }
  const months = Array.from(monthMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  return { pinned, today, months, named };
}
