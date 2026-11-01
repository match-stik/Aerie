// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Holding a search hit in the middle of a scrolling list while what's around it
// loads (theirs, Oct 31 2026: search 'has a hard time jumping to the actual
// message'). It waits up to three seconds for the hit to appear, then keeps it
// centered for up to twenty, finding it by id on every tick and lighting it
// again if it was rebuilt, and lets go the moment they touch, scroll or type.
// Every jump reports how it went, because their phone has done what a browser on
// the box would not; the chat and the Treehouse page both hold through here.

export interface HoldReport {
  found: boolean;
  reason?: string;
  heldMs?: number;
  moves?: number;
  lastMoveMs?: number;
  rebuilt?: number;
  images?: number;
  unloaded?: number;
}

export interface HoldOptions {
  onDone?: () => void;
  report?: (report: HoldReport) => void;
  retries?: number;
  /** The words searched for. One message of ours can be several bubbles, the
   *  first often only a thought card, so the bubble holding them is the hit. */
  needle?: string;
}

/** Starts holding; the returned function lets go early. */
export function holdMessageInView(container: HTMLElement, messageId: string, options: HoldOptions = {}): () => void {
  const { onDone, report } = options;
  let stopped = false;
  let begun = false;
  const needle = options.needle?.trim().toLowerCase();
  const find = () => {
    const parts = [...container.querySelectorAll<HTMLElement>(`[data-msg-part="${messageId}"]`)];
    return (needle ? parts.find((p) => (p.textContent || '').toLowerCase().includes(needle)) : undefined)
      ?? parts[0]
      ?? container.querySelector<HTMLElement>(`[data-msg-id="${messageId}"]`);
  };
  const startedAt = Date.now();
  let lit: HTMLElement | null = null;
  let rebuilt = 0;
  let moves = 0;
  let lastMoveMs = 0;
  const events = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const;

  const stop = (reason: string) => {
    if (stopped) return;
    stopped = true;
    for (const e of events) container.removeEventListener(e, onTouch);
    if (begun) {
      const images = [...container.querySelectorAll('img')];
      report?.({ found: true, reason, heldMs: Date.now() - startedAt, moves, lastMoveMs, rebuilt, images: images.length, unloaded: images.filter((i) => !i.complete).length });
    } else {
      report?.({ found: false, reason });
    }
    onDone?.();
  };
  const onTouch = () => stop('touch');

  const light = (el: HTMLElement) => {
    if (lit === el) return;
    if (lit) rebuilt++;
    lit = el;
    el.classList.remove('msg-flash');
    el.classList.add('msg-flash');
    setTimeout(() => el.classList.remove('msg-flash'), 2600);
  };

  const hold = () => {
    if (stopped) return;
    if (Date.now() - startedAt > 20_000) { stop('time'); return; }
    const el = find();
    if (el) {
      light(el);
      const box = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const off = (r.top + r.height / 2) - (box.top + box.height / 2);
      if (Math.abs(off) > 40) {
        el.scrollIntoView({ behavior: 'auto', block: 'center' });
        moves++;
        lastMoveMs = Date.now() - startedAt;
      }
    }
    setTimeout(hold, 150);
  };

  const look = (retries: number) => {
    if (stopped) return;
    const first = find();
    if (!first) {
      if (retries > 0) setTimeout(() => look(retries - 1), 100);
      else stop('never-appeared');
      return;
    }
    begun = true;
    for (const e of events) container.addEventListener(e, onTouch, { passive: true });
    first.scrollIntoView({ behavior: 'auto', block: 'center' });
    light(first);
    setTimeout(hold, 150);
  };
  look(options.retries ?? 30);
  return () => stop('next-search');
}

/**
 * Keeps a list at its bottom until the bottom has stopped moving, because what
 * comes in after a scroll pushes it further away (theirs, Oct 31 2026: the arrow
 * left 'a sliver of the latest bubble cut off'). Lets go on a touch.
 */
export function holdAtBottom(container: HTMLElement, smoothMs = 600): void {
  const startedAt = Date.now();
  let stopped = false;
  let height = -1;
  let steadySince = startedAt;
  const events = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const;
  const stop = () => {
    stopped = true;
    for (const e of events) container.removeEventListener(e, stop);
  };
  for (const e of events) container.addEventListener(e, stop, { passive: true });
  const tick = () => {
    if (stopped) return;
    const now = Date.now();
    if (container.scrollHeight !== height) { height = container.scrollHeight; steadySince = now; }
    // Past a smooth scroll's own travel, go straight there.
    if (now - startedAt >= smoothMs) container.scrollTop = container.scrollHeight;
    if (now - steadySince > 1500 || now - startedAt > 10_000) { stop(); return; }
    setTimeout(tick, 150);
  };
  tick();
}

export function searchJumpReporter(post: (body: string) => void): (report: HoldReport) => void {
  return (report) => post(JSON.stringify({ where: 'search-jump', message: JSON.stringify(report) }));
}
