// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The rail beside the table.
//
// Solitaire is the one game there is that you play alone, and this table has
// chairs for the companions anyway. Their person's line goes into the Card Room's own
// thread, the companions answer with the board in front of them, and the reply
// comes back over the socket with a poll behind it as a net.
//
// The talk itself is drawn on the house's one table (components/RoomTable.tsx),
// the same frame as the Fleet Room, the shelf and the treehouse, so voice
// splitting and their bubble settings are learned once for every room.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiFetch, markRead, useAerie, startVoiceRecording, stopVoiceRecording, cancelVoiceRecording, clearTranscription, isRecordingSupported } from '../../aerie';
import { readDraft, writeDraft } from '../../lib/thread-drafts';
import { claimMic, releaseMic } from '../../lib/mic-owner';
import { RoomTalk } from '../RoomTable';
import { getOwnSendIcon } from '../../lib/sendIcons';
import { useHouseRoster } from '../../lib/house';
import { Film, ImagePlus, Loader2, Mic, RotateCw, Smile, Square, Sticker, X } from 'lucide-react';
import { ShortcodePalette, type ShortcodeMatch } from '../ShortcodePalette';
import { matchShortcodeToken, applyShortcode } from '../../lib/shortcodes';
import { loadStickers, getStickerPacks, subscribeStickers } from '../../aerie/stickers';
import { AnimatePresence } from 'motion/react';
import { StickerPicker } from '../StickerPicker';
import { EmojiPicker } from '../EmojiPicker';
import { GifPicker } from '../GifPicker';
import { useRoomBubbleSettings } from '../RoomBubble';
import { useBackHandler } from '../../lib/use-back-handler';
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

export function CardRail({ tableId, colors, base = '/api/games/cards', label = 'the Card Room', extraBody }: {
  tableId: string | null;
  /** Anything a room sends along with their line (the Videos tab: which video, and where their player is). */
  extraBody?: () => Record<string, unknown>;
  colors: ThemeConfig['light'];
  /** Which room's rail and chat this is; Bingo Night sits on the same rail (Nov 4 2026). */
  base?: string;
  label?: string;
}) {
  const SendIcon = getOwnSendIcon();
  const { companions } = useHouseRoster();
  const [messages, setMessages] = useState<RailMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // What they have typed and not sent stays put when they leave the room and
  // comes back (theirs, Nov 11 2026: 'tables aren't saving my messages in the
  // input box'), kept per room the way the chat keeps one per thread.
  const draftKey = `table:${base}`;
  const [draft, setDraftState] = useState(() => readDraft(draftKey));
  const setDraft = useCallback((text: string | ((prev: string) => string)) => {
    setDraftState((prev) => {
      const next = typeof text === 'function' ? text(prev) : text;
      writeDraft(draftKey, next, 'table');
      return next;
    });
  }, [draftKey]);
  // Pictures and talk-to-type at the table, the chat's own two (theirs, Nov 11
  // 2026). A picture is uploaded the moment it is picked and rides their line as
  // an image; the house hands it to us to look at. The mic is the chat's
  // transcription, its text landing in this box, not the chat's.
  const [pictures, setPictures] = useState<Array<{ key: string; url: string | null; failed?: boolean }>>([]);
  const pictureInput = useRef<HTMLInputElement>(null);
  const transcription = useAerie((st) => st.transcription);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const recording = !!recordingId && transcription.status === 'recording';
  const transcribing = !!recordingId && transcription.status === 'processing';
  useEffect(() => {
    if (!recordingId) return;
    if (transcription.recordingId && transcription.recordingId !== recordingId) return;
    if (transcription.status === 'complete') {
      const said = (transcription.text || '').trim();
      if (said) setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${said}` : said));
      clearTranscription();
      releaseMic('table');
      setRecordingId(null);
    } else if (transcription.status === 'error' || transcription.status === 'idle') {
      if (transcription.status === 'error') clearTranscription();
      releaseMic('table');
      setRecordingId(null);
    }
  }, [transcription, recordingId, setDraft]);
  // Leaving the room mid-recording lets the mic go; only then, never on every change.
  const liveRecording = useRef<string | null>(null);
  liveRecording.current = recordingId;
  useEffect(() => () => { if (liveRecording.current) { cancelVoiceRecording(); releaseMic('table'); } }, []);
  const toggleMic = async () => {
    if (recording) { stopVoiceRecording(); return; }
    if (recordingId || !isRecordingSupported()) return;
    claimMic('table');
    try {
      const id = await startVoiceRecording();
      if (id) setRecordingId(id);
      else releaseMic('table');
    } catch {
      releaseMic('table');
      setRecordingId(null);
    }
  };
  const addPictures = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files).slice(0, 4)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setPictures((list) => [...list, { key, url: null }]);
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await apiFetch('/api/files', { method: 'POST', body: form });
        const body = await res.json().catch(() => null) as { url?: unknown } | null;
        if (!res.ok || !body || typeof body.url !== 'string') throw new Error('upload');
        setPictures((list) => list.map((p) => (p.key === key ? { ...p, url: body.url as string } : p)));
      } catch {
        setPictures((list) => list.map((p) => (p.key === key ? { ...p, failed: true } : p)));
      }
    }
  };
  // A sticker at the table, the same tray as chat, on a line of its own; Enter
  // is a new line here and the button sends (their person's ask, Oct 26 2026).
  const [stickers, setStickers] = useState(false);
  // Emojis and GIFs too, the chat's own trays (theirs, Nov 7 2026). An emoji
  // goes in where they are typing; a GIF goes on a line of its own as a picture.
  const [tray, setTray] = useState<'emoji' | 'gif' | null>(null);
  useBackHandler(tray !== null, () => setTray(null));
  const room = useRoomBubbleSettings();
  // A GIF waits beside the box as a picture until they send, rather than
  // sitting in it as ![gif](...) text (theirs, Nov 7 2026: it read as a link).
  const [gif, setGif] = useState<string | null>(null);

  // The chat's colon tray, here too (theirs, Nov 7 2026): ':' finds their emojis,
  // '::' finds stickers, the same lookup ChatInput runs.
  const [caret, setCaret] = useState(0);
  const [stickerTick, setStickerTick] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribeStickers(() => setStickerTick((n) => n + 1));
    void loadStickers().then(() => setStickerTick((n) => n + 1));
    return unsubscribe;
  }, []);
  const token = useMemo(() => matchShortcodeToken(draft, caret), [draft, caret]);
  const stickerTrayOpen = token?.colons === '::';
  useEffect(() => { if (stickerTrayOpen) void loadStickers(true); }, [stickerTrayOpen]);
  const matches = useMemo<ShortcodeMatch[]>(() => {
    if (!token) return [];
    void stickerTick;
    const q = token.query.toLowerCase();
    const out: ShortcodeMatch[] = [];
    if (token.colons === ':') {
      for (const e of room?.customEmojis || []) {
        if (e.shortcode.toLowerCase().includes(q)) out.push({ code: `:${e.shortcode}:`, label: e.shortcode, kind: 'emoji', url: e.url });
      }
    } else {
      for (const pack of getStickerPacks()) {
        for (const st of pack.stickers || []) {
          const ref = `${pack.name}_${st.name}`;
          if (ref.toLowerCase().includes(q) || st.name.toLowerCase().includes(q)) out.push({ code: `::${ref}::`, label: ref, kind: 'sticker', url: st.url });
        }
      }
    }
    return out
      .sort((a, b) => {
        const aStarts = a.label.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.label.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.label.localeCompare(b.label);
      })
      .slice(0, 30);
  }, [token, room?.customEmojis, stickerTick]);
  const [pick, setPick] = useState(0);
  useEffect(() => { setPick(0); }, [token?.query, token?.colons]);
  const choose = (m: ShortcodeMatch) => {
    if (!token) return;
    const { content: next, caret: pos } = applyShortcode(draft, token, caret, m.code);
    setDraft(next);
    requestAnimationFrame(() => {
      const el = draftBox.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };
  const draftBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const box = draftBox.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(Math.max(box.scrollHeight, 44), 120)}px`;
  }, [draft]);

  const load = useCallback(async () => {
    const res = await apiFetch(`${base}/rail${tableId ? `?id=${tableId}` : ''}`);
    const body = await res.json().catch(() => null);
    if (!body || !('messages' in body)) return;
    setMessages(body.messages as RailMessage[]);
    if (typeof body.threadId === 'string') setThreadId(body.threadId);
    setPending(Boolean(body.companionPending));
  }, [tableId, base]);

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
  // when a turn closes, but a dropped socket would otherwise leave their person looking
  // at "at the table…" for ever with the reply already sitting in the thread.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [pending, load]);

  // Reading the table talk here is reading it. Only the chat screen ever marked
  // a thread read, so every other room that shows one left a badge behind.
  const latestId = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (!threadId || !latestId || latestId.startsWith('local-')) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    markRead(threadId, latestId);
  }, [threadId, latestId]);

  // A line that didn't reach the house waits here with a Retry, the way the
  // chat's failed sends do (theirs, Nov 11 2026: 'need the retry send on the
  // tables too'). A 409 is the table already mid-reply: it waits the same way.
  const [unsent, setUnsent] = useState<string | null>(null);
  const deliver = useCallback(async (content: string) => {
    let ok = false;
    try {
      const res = await apiFetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(extraBody?.() ?? {}), tableId, content }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    setUnsent(ok ? null : content);
    if (!ok) setPending(false);
    void load();
  }, [base, extraBody, tableId, load]);

  const send = useCallback(async () => {
    const words = draft.trim();
    if (pictures.some((p) => !p.url && !p.failed)) return;
    const pics = pictures.filter((p) => p.url).map((p) => `![picture](${p.url})`);
    const parts = [words, ...pics, gif ? `![gif](${gif})` : ''].filter(Boolean);
    const content = parts.join('\n');
    if (!content || !tableId) return;
    setDraft('');
    setGif(null);
    setPictures([]);
    // Show their person's line immediately; the server writes the real row and the next
    // refresh replaces this one.
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: 'user', content, createdAt: new Date().toISOString() }]);
    setPending(true);
    await deliver(content);
  }, [draft, gif, pictures, tableId, setDraft, deliver]);

  // The talk is drawn once per change in what was said, not once per letter
  // they type: every keystroke re-ran every bubble's markdown, which is why
  // the box lagged behind their thumbs (theirs, Nov 7 2026).
  const talk = useMemo(() => (
    <RoomTalk
      className="flex-1 p-3"
      lines={messages}
      companions={companions}
      typing={pending}
      typingLabel="At the table…"
      empty={(
        <div
          className="flex min-h-40 items-center justify-center rounded-[calc(22px*var(--shape-scale,1))] border border-dashed px-6 text-center text-[14px] leading-6"
          style={{ borderColor: PANEL_BORDER, color: PANEL_TEXT }}
        >
          They're at the table. Say something.
        </div>
      )}
    />
  ), [messages, companions, pending]);

  return (
    // No surface of its own. The room it sits in already paints one, and two
    // stacked panels made the Card Room's header read as a colored band that
    // the Fleet Room does not have.
    <div className="flex h-full flex-col" style={{ color: PANEL_TEXT }}>
      {/* The house's one table (components/RoomTable.tsx; theirs, Oct 28 2026:
          one frame every room draws from). */}
      {talk}

      <div className="relative border-t px-3 pb-3 pt-2" style={{ borderColor: PANEL_BORDER }}>
        {/* The trays sit in a slim row above the box, the way the chat's do,
            so the box gets the whole width (theirs, Nov 7 2026: smaller buttons,
            a longer box). Enter is a new line; the button sends. */}
        {/* The colon tray floats over the talk rather than pushing it out of
            the box (theirs, Nov 7 2026: it came up inside the talk and buried it). */}
        {matches.length > 0 && room && (
          <div className="absolute inset-x-2 bottom-full z-20">
          <ShortcodePalette
            matches={matches}
            query={token?.query || ''}
            prefix={token?.colons || ':'}
            selectedIndex={pick}
            onSelect={choose}
            onHoverIndex={setPick}
            themeConfig={room.themeConfig}
            themeMode={room.themeMode}
          />
          </div>
        )}
        {unsent && (
          <div className="mb-2 flex items-center gap-2 rounded-[var(--shape-control)] border px-3 py-2 text-[13px]" style={{ borderColor: PANEL_BORDER, color: PANEL_TEXT }}>
            <span className="min-w-0 flex-1 truncate">Didn't send: {unsent}</span>
            <button type="button" onClick={() => { const c = unsent; setUnsent(null); setPending(true); void deliver(c); }} className="flex items-center gap-1 font-semibold" style={{ color: colors.accent }}>
              <RotateCw size={13} /> Retry
            </button>
            <button type="button" onClick={() => { setDraft((d) => (d.trim() ? d : unsent)); setUnsent(null); }} aria-label="Put it back in the box" title="Put it back in the box" className="opacity-70">
              <X size={14} />
            </button>
          </div>
        )}
        {pictures.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pictures.map((p) => (
              <div key={p.key} className="relative">
                {p.url
                  ? <img src={p.url} alt="Picture to send" className="h-20 w-20 rounded-[var(--shape-control)] object-cover" />
                  : <div className="flex h-20 w-20 items-center justify-center rounded-[var(--shape-control)] border text-[11px]" style={{ borderColor: PANEL_BORDER, color: PANEL_TEXT }}>{p.failed ? 'Did not upload' : <Loader2 size={16} className="animate-spin" />}</div>}
                <button
                  type="button"
                  onClick={() => setPictures((list) => list.filter((q) => q.key !== p.key))}
                  aria-label="Remove the picture"
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border"
                  style={{ backgroundColor: PANEL_SURFACE, borderColor: PANEL_BORDER, color: PANEL_TEXT }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {gif && (
          <div className="relative mb-2 inline-block">
            <img src={gif} alt="GIF to send" className="h-20 w-auto rounded-[var(--shape-control)] object-cover" referrerPolicy="no-referrer" />
            <button
              type="button"
              onClick={() => setGif(null)}
              aria-label="Remove the GIF"
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border"
              style={{ backgroundColor: PANEL_SURFACE, borderColor: PANEL_BORDER, color: PANEL_TEXT }}
            >
              <X size={12} />
            </button>
          </div>
        )}
        <div className="mb-2 flex items-center gap-1">
          {([
            ['emoji', Smile, 'Add an emoji'],
            ['gif', Film, 'Add a GIF'],
          ] as const).map(([which, Icon, name]) => (
            <button
              key={which}
              type="button"
              onClick={() => setTray((t) => (t === which ? null : which))}
              disabled={!tableId || !room}
              aria-label={name}
              title={name}
              className="flex h-8 w-8 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-30"
              style={{ color: tray === which ? colors.accent : PANEL_TEXT }}
            >
              <Icon size={17} />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setStickers(true)}
            disabled={!tableId}
            aria-label="Add a sticker"
            title="Add a sticker"
            className="flex h-8 w-8 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-30"
            style={{ color: PANEL_TEXT }}
          >
            <Sticker size={17} />
          </button>
          <button
            type="button"
            onClick={() => pictureInput.current?.click()}
            disabled={!tableId}
            aria-label="Add a picture"
            title="Add a picture"
            className="flex h-8 w-8 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-30"
            style={{ color: PANEL_TEXT }}
          >
            <ImagePlus size={17} />
          </button>
          <input
            ref={pictureInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.gif,.heic"
            multiple
            className="hidden"
            onChange={(e) => { void addPictures(e.target.files); e.target.value = ''; }}
          />
          <button
            type="button"
            onClick={() => void toggleMic()}
            disabled={!tableId || transcribing}
            aria-label={recording ? 'Stop and type it' : 'Talk to type'}
            title={recording ? 'Stop and type it' : 'Talk to type'}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-30${recording ? ' animate-pulse' : ''}`}
            style={{ color: recording ? colors.accent : PANEL_TEXT }}
          >
            {transcribing ? <Loader2 size={17} className="animate-spin" /> : recording ? <Square size={15} fill="currentColor" /> : <Mic size={17} />}
          </button>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={draftBox}
            rows={1}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); }}
            onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (matches.length === 0) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setPick((i) => (i + 1) % matches.length); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setPick((i) => (i - 1 + matches.length) % matches.length); }
              else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const m = matches[pick]; if (m) choose(m); }
              else if (e.key === 'Escape') { e.preventDefault(); setCaret(-1); }
            }}
            onFocus={() => window.dispatchEvent(new CustomEvent('aerie:card-rail-typing', { detail: true }))}
            onBlur={() => window.dispatchEvent(new CustomEvent('aerie:card-rail-typing', { detail: false }))}
            placeholder={tableId ? 'Say something' : 'Deal a game first'}
            disabled={!tableId}
            className="scrollbar-hide min-w-0 flex-1 resize-none rounded-[var(--shape-control)] border px-3.5 py-2.5 text-[16px] leading-6 outline-none placeholder:opacity-60 disabled:opacity-55"
            style={{ backgroundColor: PANEL_SURFACE, borderColor: PANEL_BORDER, color: PANEL_TEXT }}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={(!draft.trim() && !gif && !pictures.some((p) => p.url)) || pictures.some((p) => !p.url && !p.failed) || !tableId}
            // Dressed like the chat's own send button (aerie-send-button in
            // index.css): the accent as the icon on a tinted surface. A solid
            // accent fill washed to 30% all but vanished on pale accents (theirs,
            // Nov 7 2026, on a sky-blue theme).
            className="aerie-send-button mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-50"
            aria-label={`Speak into ${label}`}
          >
            <SendIcon size={16} />
          </button>
        </div>
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
        <AnimatePresence>
          {tray === 'emoji' && room && (
            <EmojiPicker
              onSelect={(text) => {
                const box = draftBox.current;
                const at = box ? box.selectionStart ?? draft.length : draft.length;
                const end = box ? box.selectionEnd ?? at : at;
                setDraft((d) => d.slice(0, at) + text + d.slice(end));
                setTray(null);
                window.setTimeout(() => {
                  const b = draftBox.current;
                  if (b) { b.focus(); b.setSelectionRange(at + text.length, at + text.length); }
                }, 50);
              }}
              onClose={() => setTray(null)}
              themeConfig={room.themeConfig}
              themeMode={room.themeMode}
              customEmojis={room.customEmojis}
              emojiPacks={room.emojiPacks}
            />
          )}
          {tray === 'gif' && room && (
            <GifPicker
              onSelect={(url) => {
                setGif(url);
                setTray(null);
                window.setTimeout(() => draftBox.current?.focus(), 50);
              }}
              onClose={() => setTray(null)}
              themeConfig={room.themeConfig}
              themeMode={room.themeMode}
              apiKey={room.giphyApiKey}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
