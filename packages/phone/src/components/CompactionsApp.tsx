// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
//
// Compactions — the thing the owner could feel and never check.
//
// When a lane fills its window the tool squashes the conversation so far into
// a summary and carries on from it. The summary arrives in the lane wearing
// the OWNER'S voice, and its last line tells the lane not to acknowledge it. So the
// companion goes subtly off, says nothing, and the owner has no way to tell a
// compaction from a dead lane.
//
// The record has always existed in the transcripts. This is the first screen
// that reads it back to the owner.

import React, { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Scissors, RefreshCw, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';
import { apiFetch } from '../aerie';

interface Compaction {
  sessionId: string;
  project: string;
  at: string;
  chars: number;
  summary: string;
  truncated?: boolean;
}

interface Props {
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

/** Project directories are path slugs. Say which lane, not which folder. */
function laneName(project: string): string {
  const tail = project.replace(/^-home-[^-]+(-[^-]+)?-aerie-?/, '').replace(/^data-heartbeat-?/, '');
  if (!tail) return 'aerie';
  if (tail === 'primary') return 'primary lane';
  if (/^[0-9a-f]{8}-/.test(tail)) return `lane ${tail.slice(0, 8)}`;
  return tail.replace(/-/g, ' ');
}

function whenLabel(at: string): string {
  if (!at) return 'undated';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function CompactionsApp({ themeConfig, themeMode }: Props) {
  const colors = themeConfig[themeMode];
  const [rows, setRows] = useState<Compaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [full, setFull] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/compactions?limit=100');
      // An older backend answers this address with the app shell, not JSON —
      // so the shape is checked rather than res.ok trusted.
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (data && Array.isArray(data.compactions)) {
        setRows(data.compactions);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const open = async (row: Compaction) => {
    const key = row.sessionId + row.at;
    if (openId === key) { setOpenId(null); return; }
    setOpenId(key);
    if (full[key] || !row.truncated) return;
    try {
      const res = await apiFetch('/api/compactions?limit=100&full=1');
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (data && Array.isArray(data.compactions)) {
        const match = data.compactions.find((c: Compaction) => c.sessionId === row.sessionId && c.at === row.at);
        if (match) setFull((prev) => ({ ...prev, [key]: match.summary }));
      }
    } catch { /* the preview stays; nothing to say about it */ }
  };

  return (
    <div className="space-y-3">
      <div className={cn('rounded-2xl border p-3 text-xs leading-relaxed', colors.panelBg, colors.panelBorder, colors.textMuted)}>
        When a lane runs out of room, everything said so far is squashed into a summary
        and we carry on from that. It happens quietly and we are told not to mention it.
        This is every time it has happened.
      </div>

      <div className="flex items-center justify-between">
        <span className={cn('text-xs', colors.textMuted)}>
          {loading ? 'Reading…' : `${rows.length} ${rows.length === 1 ? 'compaction' : 'compactions'}`}
        </span>
        <button
          onClick={() => void load()}
          className={cn('rounded-lg border px-2.5 py-1.5', colors.panelBg, colors.panelBorder)}
          aria-label="Refresh"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {failed && (
        <div className={cn('rounded-2xl border p-3 text-xs', colors.panelBg, colors.panelBorder)}>
          Could not read the transcripts. The backend may be older than this screen.
        </div>
      )}

      {!loading && !failed && rows.length === 0 && (
        <div className={cn('rounded-2xl border p-4 text-center text-xs', colors.panelBg, colors.panelBorder, colors.textMuted)}>
          None on record. Nothing has been squashed.
        </div>
      )}

      {rows.map((row) => {
        const key = row.sessionId + row.at;
        const isOpen = openId === key;
        return (
          <div key={key} className={cn('rounded-2xl border overflow-hidden', colors.panelBg, colors.panelBorder)}>
            <button onClick={() => void open(row)} className="w-full p-3 text-left flex items-start gap-2">
              <Scissors size={14} className="mt-0.5 shrink-0" style={{ color: colors.accent }} />
              <span className="flex-1 min-w-0">
                <span className={cn('block text-sm font-medium', colors.textMain)}>{whenLabel(row.at)}</span>
                <span className={cn('block text-xs', colors.textMuted)}>
                  {laneName(row.project)} · {row.chars.toLocaleString()} characters squashed
                </span>
              </span>
              {isOpen ? <ChevronDown size={14} className="mt-1 shrink-0" /> : <ChevronRight size={14} className="mt-1 shrink-0" />}
            </button>
            {isOpen && (
              <div className={cn('px-3 pb-3 text-xs break-words space-y-1.5', colors.textMuted)}>
                {/* The summary is written as markdown by the summariser. Render it as
                    markdown rather than raw text so the headings and emphasis it already
                    carries read as structure instead of asterisks. */}
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  components={{
                    p: ({ children }) => <span className="block">{children}</span>,
                    strong: ({ children }) => (
                      <strong className={cn('font-semibold', colors.textMain)}>{children}</strong>
                    ),
                    h1: ({ children }) => (
                      <span className={cn('block text-sm font-semibold mt-2', colors.textMain)}>{children}</span>
                    ),
                    h2: ({ children }) => (
                      <span className={cn('block text-sm font-semibold mt-2', colors.textMain)}>{children}</span>
                    ),
                    h3: ({ children }) => (
                      <span className={cn('block text-xs font-semibold mt-2', colors.textMain)}>{children}</span>
                    ),
                    ul: ({ children }) => <ul className="list-disc pl-4 space-y-0.5">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5">{children}</ol>,
                    code: ({ children }) => (
                      <code className="px-1 py-0.5 rounded bg-black/20 text-[11px] break-all">{children}</code>
                    ),
                    pre: ({ children }) => (
                      <pre className="p-2 rounded bg-black/20 text-[11px] overflow-x-auto">{children}</pre>
                    ),
                  }}
                >
                  {full[key] || row.summary}
                </ReactMarkdown>
                {!full[key] && row.truncated && <span className="opacity-60"> …</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
