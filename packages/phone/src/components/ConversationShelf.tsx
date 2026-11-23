// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Cortex's conversation shelf, to browse and read. A list with a
// search and a filter by where each one came from; tapping one opens it whole,
// a page at a time, and nothing is loaded until it is tapped.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, MessagesSquare, Search, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { cn } from '../lib/utils';
import { Paginator, usePaged } from './Paginator';
import { useBackHandler } from '../lib/use-back-handler';

export interface ShelfConversation {
  id: string;
  title: string;
  domain?: string;
  summary?: string;
  created_at?: string;
}

interface ShelfColors { textMain: string; textMuted: string; panelBorder: string; panelBg: string; accent: string }

/** "OLD WINDOW — Gemini — 2026-09-20 — Title" into its parts; anything else is kept whole. */
export function readShelfTitle(title: string): { house: string | null; date: string | null; name: string; summary?: boolean } {
  const m = /^OLD WINDOW\s+—\s+(.+?)\s+—\s+(\d{4}-\d{2}-\d{2})\s+—\s+(.*)$/.exec(title);
  if (m) return { house: m[1], date: m[2], name: m[3] || 'Untitled' };
  // The Oct 1 2026 import also shelved written summaries of the long GPT
  // window, slice by slice; they are notes about chats, not chats.
  const s = /^OLD WINDOW SUMMARY\s+—\s+(.+?)\s+—\s+(.*)$/.exec(title);
  if (s) return { house: s[1], date: null, name: s[2] || 'Summary', summary: true };
  return { house: null, date: null, name: title || 'Untitled' };
}

/** Which chip a conversation sits under. */
export function shelfGroup(title: string): string {
  const t = readShelfTitle(title);
  if (t.summary) return 'Summaries';
  return t.house ?? 'Ours';
}

export interface ShelfTurn { speaker: string; date: string; text: string; thinking: string[] }

const HEADING = /^#{2,3}[ \t]+(.+?)[ \t]*$/;
const DATED = /^(.{1,40}?) — (\d{4}-\d{2}-\d{2}.*)$/;

/**
 * A conversation's text as its speakers' turns. The shelf holds two shapes: the
 * imports' "### Speaker — date" headings, and the older windows' "## Speaker"
 * headings with the time on an italic line under them, behind a front-matter
 * block and a title. A dated heading is always a speaker; an undated one only
 * when the same name heads two turns or more, so a heading inside somebody's
 * answer stays part of the answer. The old Claude windows carry the model's
 * own thinking as "> [!note]- thinking" quotes, which come out folded away
 * rather than read as the answer.
 */
export function splitTurns(content: string): ShelfTurn[] {
  const body = content.replace(/^﻿?---\n[\s\S]*?\n---[ \t]*\n/, '');
  const lines = body.split('\n');
  const counts = new Map<string, number>();
  for (const line of lines) {
    const h = HEADING.exec(line);
    if (h && !DATED.test(h[1])) counts.set(h[1], (counts.get(h[1]) ?? 0) + 1);
  }
  // The older windows put the time on an italic line straight under the name.
  const stampedNext = (i: number): boolean => {
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      return /^\*\d{4}-\d{2}-\d{2}[^*]*\*\s*$/.test(lines[j].trim());
    }
    return false;
  };
  const speakerOf = (line: string, i: number): { speaker: string; date: string } | null => {
    const h = HEADING.exec(line);
    if (!h) return null;
    const d = DATED.exec(h[1]);
    if (d) return { speaker: d[1], date: d[2] };
    return (counts.get(h[1]) ?? 0) >= 2 || stampedNext(i) ? { speaker: h[1], date: '' } : null;
  };
  const turns: { speaker: string; date: string; lines: string[] }[] = [];
  for (const [i, line] of lines.entries()) {
    const who = speakerOf(line, i);
    if (who) { turns.push({ ...who, lines: [] }); continue; }
    if (turns.length) turns[turns.length - 1].lines.push(line);
  }
  // No speaker headings at all: show the whole thing as one card.
  if (!turns.length) return body.trim() ? [{ speaker: '', date: '', text: body.trim(), thinking: [] }] : [];
  const mapped: ShelfTurn[] = turns.map((t) => {
    const thinking: string[] = [];
    const kept: string[] = [];
    let quote: string[] | null = null;
    for (const line of t.lines) {
      if (/^>\s*\[!note\][-+]?\s*thinking/i.test(line)) { quote = []; thinking.push(''); continue; }
      if (quote && /^>/.test(line)) { thinking[thinking.length - 1] += `${line.replace(/^>\s?/, '')}\n`; continue; }
      quote = null;
      kept.push(line);
    }
    let text = kept.join('\n').trim();
    let date = t.date;
    const stamp = /^\*(\d{4}-\d{2}-\d{2}[^*]*)\*\s*\n?/.exec(text);
    if (stamp) { date = date || stamp[1].trim(); text = text.slice(stamp[0].length).trim(); }
    text = text.replace(/^\*\*\s*$/gm, '').replace(/(\n\s*-{3,}\s*)+$/, '').replace(/^\s*-{3,}\s*$/, '').trim();
    return { speaker: t.speaker, date, text, thinking: thinking.map((x) => x.trim()).filter(Boolean) };
  });
  // A turn with no words of its own (the old Claude windows wrote a thinking-only
  // step before a tool call) drew as an empty card. Its
  // thinking moves onto the same speaker's next turn, and an empty turn goes.
  const kept: ShelfTurn[] = [];
  for (let i = 0; i < mapped.length; i++) {
    const turn = mapped[i];
    if (turn.text) { kept.push(turn); continue; }
    const next = mapped[i + 1];
    if (turn.thinking.length && next && next.speaker === turn.speaker) {
      next.thinking = [...turn.thinking, ...next.thinking];
      if (!next.date) next.date = turn.date;
    } else if (turn.thinking.length) {
      kept.push(turn);
    }
  }
  return kept;
}

/** The shelf's summary without the import's bookkeeping (file paths, part counts). */
export function shortSummary(summary: string | undefined): string {
  if (!summary) return '';
  return summary
    .replace(/^Imported from an? .+? export\.\s*/, '')
    .replace(/\s*Part \d+ of \d+\./, '')
    .replace(/\s*Imported [\s\S]*$/, '')
    .trim();
}

const ALL = 'All';

export function ConversationShelf({ colors }: { colors: ShelfColors }) {
  const [list, setList] = useState<ShelfConversation[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState<ShelfConversation[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [house, setHouse] = useState(ALL);
  const [open, setOpen] = useState<ShelfConversation | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/cortex/conversations', { credentials: 'include' })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!live) return;
        if (!r.ok || !Array.isArray(data?.results)) throw new Error(data?.error || 'The shelf did not answer.');
        setList(data.results);
      })
      .catch((err) => { if (live) setError(err?.message || 'The shelf did not answer.'); });
    return () => { live = false; };
  }, []);

  const runSearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) { setSearched(null); return; }
    setSearching(true);
    try {
      const r = await fetch(`/api/cortex/conversations?q=${encodeURIComponent(q)}`, { credentials: 'include' });
      const data = await r.json().catch(() => null);
      setSearched(Array.isArray(data?.results) ? data.results : []);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const source = searched ?? list ?? [];
  const houses = useMemo(() => {
    const seen = new Set<string>();
    for (const c of list ?? []) seen.add(shelfGroup(c.title));
    const groups = [...seen].sort().filter((g) => g !== 'Summaries');
    return [ALL, ...groups, ...(seen.has('Summaries') ? ['Summaries'] : [])];
  }, [list]);
  const shown = useMemo(() => source
    // Summaries stay under their own chip rather than mixed in with the chats.
    .filter((c) => (house === ALL ? shelfGroup(c.title) !== 'Summaries' : shelfGroup(c.title) === house))
    .sort((a, b) => {
      const da = readShelfTitle(a.title).date ?? a.created_at ?? '';
      const db = readShelfTitle(b.title).date ?? b.created_at ?? '';
      return db.localeCompare(da);
    }), [source, house]);
  const paged = usePaged(shown, 20);

  if (open) return <ShelfReader conv={open} colors={colors} onBack={() => setOpen(null)} />;

  return (
    <div className="space-y-3">
      {/* One card holds the search, the count and the house filter, so nothing
          floats loose and nothing runs off the side. */}
      <div className={cn('space-y-2.5 p-3 rounded-[var(--shape-surface)] border', colors.panelBorder, colors.panelBg)}>
        <form onSubmit={runSearch} className="flex gap-2">
          <div className={cn('flex flex-1 items-center gap-2 px-3 rounded-[var(--shape-control)] border', colors.panelBorder)}>
            <Search size={14} className="opacity-60" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find words in a conversation..."
              className="w-full bg-transparent py-2 text-sm outline-none"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); setSearched(null); }} className="opacity-60">
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="px-4 rounded-[var(--shape-control)] text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}
          >
            {searching ? '...' : 'Find'}
          </button>
        </form>
        {houses.length > 2 && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {houses.map((h) => (
              <button
                key={h}
                onClick={() => { setHouse(h); paged.setPage(1); }}
                className={cn('rounded-[var(--shape-chip)] border px-3 py-1 text-xs', colors.panelBorder)}
                style={house === h ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: colors.accent } : undefined}
              >
                {h}
              </button>
            ))}
          </div>
        )}
        <div className={cn('text-xs', colors.textMuted)}>
          {list === null && !error ? 'Opening the shelf…' : `${shown.length} ${searched ? 'found' : 'conversations'}${paged.pageCount > 1 ? ` · page ${paged.page} of ${paged.pageCount}` : ''}`}
        </div>
      </div>

      {error && <div className={cn('rounded-[var(--shape-surface)] border p-4 text-sm', colors.panelBg, colors.panelBorder)}>{error}</div>}

      <div className="space-y-2">
        {paged.visible.map((c) => {
          const t = readShelfTitle(c.title);
          return (
            <button
              key={c.id}
              onClick={() => setOpen(c)}
              className={cn('w-full text-left p-3 rounded-[var(--shape-surface)] border', colors.panelBorder, colors.panelBg)}
            >
              <div className={cn('text-sm font-medium leading-snug', colors.textMain)}>{t.name}</div>
              <div className={cn('mt-1 text-[11px]', colors.textMuted)}>
                {[t.house, t.date ?? c.created_at?.slice(0, 10), c.summary?.match(/(\d+) messages?/)?.[0]].filter(Boolean).join(' · ')}
              </div>
            </button>
          );
        })}
      </div>

      <Paginator page={paged.page} pageCount={paged.pageCount} onPage={paged.setPage} colors={colors} />
    </div>
  );
}

const TURNS_PER_PAGE = 25;
/** The most pages of a conversation fetched at once: about a million characters. */
const MAX_FETCHES = 25;

function ShelfReader({ conv, colors, onBack }: { conv: ShelfConversation; colors: ShelfColors; onBack: () => void }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const topRef = React.useRef<HTMLDivElement>(null);
  useBackHandler(true, onBack);

  // The whole conversation comes in before it is drawn, so it can be read in
  // pages that stay the same length instead of one scroll that keeps growing
  //.
  useEffect(() => {
    let live = true;
    (async () => {
      let text = '';
      let offset = 0;
      try {
        for (let i = 0; i < MAX_FETCHES; i++) {
          const r = await fetch(`/api/cortex/conversation/${encodeURIComponent(conv.id)}?offset=${offset}`, { credentials: 'include' });
          const data = await r.json().catch(() => null);
          if (!r.ok || typeof data?.content !== 'string') throw new Error(data?.error || 'That conversation did not open.');
          text += data.content;
          if (typeof data.next_offset !== 'number' || data.next_offset <= offset) break;
          offset = data.next_offset;
        }
        if (live) setContent(text);
      } catch (err: any) {
        if (live) { setContent(text); setError(err?.message || 'That conversation did not open.'); }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [conv.id]);

  const t = readShelfTitle(conv.title);
  const turns = useMemo(() => splitTurns(content), [content]);
  const paged = usePaged(turns, TURNS_PER_PAGE);
  const turnTo = (page: number) => {
    paged.setPage(page);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start' }));
  };

  return (
    <div className="space-y-3">
      <div ref={topRef} className={cn('p-3 rounded-[var(--shape-surface)] border', colors.panelBorder, colors.panelBg)}>
        <button onClick={onBack} className={cn('mb-2 flex items-center gap-1 text-xs', colors.textMuted)}>
          <ChevronLeft size={14} /> All conversations
        </button>
        <div className={cn('flex items-center gap-2 text-sm font-medium', colors.textMain)}>
          <MessagesSquare size={14} style={{ color: colors.accent }} /> {t.name}
        </div>
        <div className={cn('mt-1 text-[11px]', colors.textMuted)}>
          {[t.house, shortSummary(conv.summary), paged.pageCount > 1 ? `page ${paged.page} of ${paged.pageCount}` : ''].filter(Boolean).join(' · ')}
        </div>
      </div>

      {error && <div className={cn('rounded-[var(--shape-surface)] border p-4 text-sm', colors.panelBg, colors.panelBorder)}>{error}</div>}
      {loading && <div className={cn('flex justify-center py-4', colors.textMuted)}><Loader2 size={18} className="animate-spin" /></div>}

      <div className="space-y-2">
        {paged.visible.map((turn, i) => (
          <div key={`${paged.page}-${i}`} className={cn('p-3 rounded-[var(--shape-surface)] border', colors.panelBorder, colors.panelBg)}>
            {turn.speaker && (
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: colors.accent }}>
                {turn.speaker}{turn.date ? <span className={cn('ml-2 font-normal normal-case tracking-normal', colors.textMuted)}>{turn.date}</span> : null}
              </div>
            )}
            {turn.thinking.length > 0 && <ThinkingFold notes={turn.thinking} colors={colors} />}
            {turn.text && (
              <div className={cn('text-sm leading-relaxed break-words [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:opacity-80 [&_hr]:my-3 [&_hr]:opacity-30 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_pre]:whitespace-pre-wrap [&_code]:text-[13px]', colors.textMain)}>
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{turn.text}</ReactMarkdown>
              </div>
            )}
          </div>
        ))}
      </div>

      {paged.pageCount > 1 && <Paginator page={paged.page} pageCount={paged.pageCount} onPage={turnTo} colors={colors} />}
    </div>
  );
}

/** The old windows' own thinking, folded closed: it was the model talking to
 *  itself, not to the person, and some of it is hard to read. */
function ThinkingFold({ notes, colors }: { notes: string[]; colors: ShelfColors }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button onClick={() => setOpen((v) => !v)} className={cn('flex items-center gap-1 text-[11px]', colors.textMuted)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} its thinking
      </button>
      {open && (
        <div className={cn('mt-1 border-l-2 pl-3 text-xs italic whitespace-pre-wrap opacity-70', colors.panelBorder, colors.textMuted)}>
          {notes.join('\n\n')}
        </div>
      )}
    </div>
  );
}
