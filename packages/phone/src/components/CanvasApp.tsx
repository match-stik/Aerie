// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React, { useEffect, useState } from 'react';
import { FileText, RefreshCw, Loader2, Plus, Trash2 } from 'lucide-react';
import { AppShell } from './AppShell';
import { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';
import { apiFetch } from '../aerie';

interface CanvasAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

interface Canvas {
  id: string;
  title: string;
  content: string;
  content_type: 'markdown' | 'code' | 'text' | 'html';
  language: string | null;
  created_at: string;
  updated_at: string;
}

const TYPES: Canvas['content_type'][] = ['markdown', 'code', 'text', 'html'];

export function CanvasApp({ onClose, themeConfig, themeMode }: CanvasAppProps) {
  const colors = themeConfig[themeMode];
  const [list, setList] = useState<Canvas[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Canvas | null>(null);
  const [draft, setDraft] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<Canvas['content_type']>('markdown');

  async function loadList() {
    setLoading(true);
    try {
      const res = await apiFetch('/api/canvases');
      if (res.ok) setList((await res.json()).canvases || []);
    } catch {
      /* empty */
    }
    setLoading(false);
  }

  useEffect(() => {
    loadList();
  }, []);

  async function open(id: string) {
    try {
      const res = await apiFetch(`/api/canvases/${id}`);
      if (res.ok) {
        const canvas: Canvas = (await res.json()).canvas;
        setActive(canvas);
        setDraft(canvas.content || '');
        setDraftTitle(canvas.title);
      }
    } catch {
      /* ignore */
    }
  }

  async function createCanvas() {
    if (!newTitle.trim()) return;
    try {
      const res = await apiFetch('/api/canvases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), contentType: newType }),
      });
      if (res.ok) {
        const canvas: Canvas = (await res.json()).canvas;
        setNewTitle('');
        setShowCreate(false);
        await loadList();
        setActive(canvas);
        setDraft(canvas.content || '');
        setDraftTitle(canvas.title);
      }
    } catch {
      /* ignore */
    }
  }

  async function save() {
    if (!active) return;
    setSaving(true);
    try {
      await apiFetch(`/api/canvases/${active.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draftTitle, content: draft }),
      });
      await loadList();
    } catch {
      /* ignore */
    }
    setSaving(false);
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/api/canvases/${id}`, { method: 'DELETE' });
      if (active?.id === id) setActive(null);
      await loadList();
    } catch {
      /* ignore */
    }
  }

  const input = cn('rounded-lg border px-3 py-2 text-sm bg-transparent', colors.panelBorder, colors.textMain);

  if (active) {
    return (
      <AppShell
        title="Canvas"
        icon={FileText}
        onClose={() => setActive(null)}
        themeConfig={themeConfig}
        themeMode={themeMode}
        bodyClassName="flex flex-col"
        headerRight={
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold aerie-on-accent disabled:opacity-50"
            style={{ background: colors.accent }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <section className={cn('shrink-0 rounded-2xl border p-3 shadow-sm backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
            <div className={cn('mb-1 text-[10px] font-bold uppercase tracking-[0.12em]', colors.textMuted)}>Document title</div>
            <input
              className={cn('w-full border-none bg-transparent p-0 text-base font-semibold outline-none', colors.textMain)}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Title"
            />
            <div className="mt-2 flex items-center gap-2">
              <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', colors.panelBorder, colors.textMuted)}>
                {active.content_type}
              </span>
              {active.language && (
                <span className={cn('text-[10px] uppercase tracking-wide', colors.textMuted)}>{active.language}</span>
              )}
            </div>
          </section>
          <section className={cn('flex min-h-[24rem] flex-1 flex-col overflow-hidden rounded-2xl border shadow-sm backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
            <div className={cn('shrink-0 px-4 pt-3 text-[10px] font-bold uppercase tracking-[0.12em]', colors.textMuted)}>Content</div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={cn(
                'min-h-0 w-full flex-1 resize-none border-none bg-transparent px-4 pb-4 pt-2 text-[13px] leading-relaxed outline-none',
                colors.textMain,
                active.content_type !== 'text' && 'font-mono',
              )}
            />
          </section>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Canvas"
      icon={FileText}
      onClose={onClose}
      themeConfig={themeConfig}
      themeMode={themeMode}
      headerRight={
        <button
          onClick={loadList}
          className={cn('rounded-full p-2 transition-colors hover:bg-black/10 dark:hover:bg-white/10', colors.textMuted)}
          title="Refresh"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
      }
    >
      <div className={cn('rounded-2xl border p-3 backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
        <div className="flex items-center justify-between mb-3">
          <span className={cn('text-[11px] font-bold uppercase tracking-[0.12em]', colors.textMuted)}>Documents</span>
          <button onClick={() => setShowCreate(!showCreate)} className="rounded-full p-1.5 aerie-on-accent" style={{ background: colors.accent }}>
            <Plus size={14} />
          </button>
        </div>

        {showCreate && (
          <div className="flex flex-col gap-2 mb-3">
            <input className={input} placeholder="Document title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <div className="flex gap-2">
              <select className={cn(input, 'flex-1')} value={newType} onChange={(e) => setNewType(e.target.value as Canvas['content_type'])}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button onClick={createCanvas} className="rounded-lg px-4 text-sm font-semibold aerie-on-accent" style={{ background: colors.accent }}>
                Create
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className={cn('text-xs py-6 text-center', colors.textMuted)}>Loading…</div>
        ) : list.length === 0 ? (
          <div className={cn('text-xs py-6 text-center', colors.textMuted)}>No canvases yet.</div>
        ) : (
          <div className="space-y-2">
            {list.map((c) => (
              <div key={c.id} className={cn('flex items-center gap-2 rounded-xl border p-3', colors.panelBorder)}>
                <button onClick={() => open(c.id)} className="flex-1 min-w-0 text-left">
                  <div className={cn('text-sm font-medium truncate', colors.textMain)}>{c.title}</div>
                  <div className={cn('text-[11px]', colors.textMuted)}>
                    {c.content_type} · {new Date(c.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </div>
                </button>
                <button onClick={() => remove(c.id)} className={cn('p-1.5 shrink-0', colors.textMuted)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
