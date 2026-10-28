// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The rail beside the table.
//
// Solitaire is the one game there is that you play alone, and this table has
// chairs for the companions anyway. The owner's line goes into the Card Room's own
// thread, the companions answer with the board in front of them, and the reply
// comes back over the socket with a poll behind it as a net.
//
// The talk itself is drawn on the house's one table (components/RoomTable.tsx),
// the same frame as the Fleet Room, the shelf and the treehouse, so voice
// splitting and their bubble settings are learned once for every room.
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch, markRead } from '../../aerie';
import { RoomTalk } from '../RoomTable';
import { getOwnSendIcon } from '../../lib/sendIcons';
import { useHouseRoster } from '../../lib/house';
import { cn } from '../../lib/utils';
import { Sticker } from 'lucide-react';
import { StickerPicker } from '../StickerPicker';
import type { ThemeConfig } from '../../lib/theme';

interface RailMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  companionSlug?: string | null;
}

const PANEL_SURFACE = 'var(--custom-panelBg, var(--aerie-surface-strong))';
const PANEL_BORDER = 'var(--custom-panelBorder, var(--aerie-border))';
const PANEL_TEXT = 'var(--aerie-text)';

export function CardRail({ tableId, colors }: { tableId: string | null; colors: ThemeConfig['light'] }) {
  const SendIcon = getOwnSendIcon();
  const { companions } = useHouseRoster();
  const [messages, setMessages] = useState<RailMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState('');
  // A sticker at the table, the same tray as chat, on a line of its own; Enter
  // is a new line here and the button sends (the owner's ask, Oct 26 2026).
  const [stickers, setStickers] = useState(false);
  const draftBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const box = draftBox.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(Math.max(box.scrollHeight, 48), 140)}px`;
  }, [draft]);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/games/cards/rail${tableId ? `?id=${tableId}` : ''}`);
    const body = await res.json().catch(() => null);
    if (!body || !('messages' in body)) return;
    setMessages(body.messages as RailMessage[]);
    if (typeof body.threadId === 'string') setThreadId(body.threadId);
    setPending(Boolean(body.companionPending));
  }, [tableId]);

  useEffect(() => { void load(); }, [load]);

  // Closing the rail can unmount a focused input without a blur ever firing —
  // release the typing hold on the way out or the table waits forever.
  useEffect(() => () => { window.dispatchEvent(new CustomEvent('aerie:card-rail-typing', { detail: false })); }, []);

  useEffect(() => {
    const onUpdate = () => void load();
    window.addEventListener('aerie:card-table-update', onUpdate);
    return () => window.removeEventListener('aerie:card-table-update', onUpdate);
  }, [load]);

  // The socket is the fast path and the poll is the net. The room broadcasts
  // when a turn closes, but a dropped socket would otherwise leave the owner looking
  // at "at the table…" for ever with the reply already sitting in the thread.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [pending, load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, pending]);

  // Reading the table talk here is reading it. Only the chat screen ever marked
  // a thread read, so every other room that shows one left a badge behind.
  const latestId = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (!threadId || !latestId || latestId.startsWith('local-')) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    markRead(threadId, latestId);
  }, [threadId, latestId]);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || !tableId) return;
    setDraft('');
    // Show the owner's line immediately; the server writes the real row and the next
    // refresh replaces this one.
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: 'user', content, createdAt: '' }]);
    setPending(true);
    await apiFetch('/api/games/cards/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableId, content }),
    });
    void load();
  }, [draft, tableId, load]);

  return (
    // No surface of its own. The room it sits in already paints one, and two
    // stacked panels made the Card Room's header read as a colored band that
    // the Fleet Room does not have.
    <div className="flex h-full flex-col" style={{ color: PANEL_TEXT }}>
      {/* The house's one table (components/RoomTable.tsx; theirs, Oct 28 2026:
          one frame every room draws from). */}
      <RoomTalk
        className="flex-1 p-3"
        lines={messages}
        companions={companions}
        typing={pending}
        typingLabel="at the table…"
        empty={(
          <div
            className="flex min-h-40 items-center justify-center rounded-[calc(22px*var(--shape-scale,1))] border border-dashed px-6 text-center text-[14px] leading-6"
            style={{ borderColor: PANEL_BORDER, color: PANEL_TEXT }}
          >
            They're at the table. Say something.
          </div>
        )}
      >
        <div ref={bottom} />
      </RoomTalk>

      <div className="flex gap-2 border-t p-3" style={{ borderColor: PANEL_BORDER }}>
        <textarea
          ref={draftBox}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => window.dispatchEvent(new CustomEvent('aerie:card-rail-typing', { detail: true }))}
          onBlur={() => window.dispatchEvent(new CustomEvent('aerie:card-rail-typing', { detail: false }))}
          placeholder={tableId ? 'say something' : 'deal a game first'}
          disabled={!tableId}
          className="min-w-0 flex-1 resize-none rounded-[var(--shape-control)] border px-4 py-3 text-[16px] leading-6 outline-none placeholder:opacity-60 disabled:opacity-55"
          style={{ backgroundColor: PANEL_SURFACE, borderColor: PANEL_BORDER, color: PANEL_TEXT }}
        />
        <button
          type="button"
          onClick={() => setStickers(true)}
          disabled={!tableId}
          aria-label="Add a sticker"
          title="Add a sticker"
          className="flex h-12 w-12 shrink-0 items-center justify-center self-end rounded-full border disabled:opacity-30"
          style={{ borderColor: PANEL_BORDER, color: PANEL_TEXT }}
        >
          <Sticker size={18} />
        </button>
        {stickers && (
          <StickerPicker
            colors={colors}
            onSelect={(code) => {
              setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, '')}\n${code}\n` : `${code}\n`));
              setStickers(false);
              window.setTimeout(() => draftBox.current?.focus(), 50);
            }}
            onClose={() => setStickers(false)}
          />
        )}
        <button
          type="button"
          onClick={() => void send()}
          disabled={!draft.trim() || !tableId}
          className={cn('flex h-12 w-12 shrink-0 items-center justify-center self-end rounded-full transition active:scale-95 disabled:opacity-30', colors.accentText)}
          style={{ backgroundColor: colors.accent }}
          aria-label="Speak into the Card Room"
        >
          <SendIcon size={18} />
        </button>
      </div>
    </div>
  );
}
