// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { PressAsset, PressFormat, PressIssue, PressSpread } from '@aerie/shared';
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Loader2,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { AppShell } from './AppShell';
import { Paginator, usePaged } from './Paginator';
import type { ThemeConfig } from '../lib/theme';
import { apiFetch } from '../aerie';
import { cn } from '../lib/utils';
import { thumbSrc } from '../lib/thumb';

const PressEditor = lazy(() => import('./press/PressEditor'));

interface PressAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

interface IssueBundle {
  issue: PressIssue;
  spreads: PressSpread[];
  assets: PressAsset[];
}

type RenameTarget = { kind: 'issue'; id: string; value: string } | { kind: 'spread'; id: string; value: string };
type PressSaveStatus = 'loading' | 'clean' | 'dirty' | 'saving' | 'error';

const FORMAT_COPY: Record<PressFormat, { label: string; ratio: string; note: string }> = {
  portrait: { label: 'Portrait', ratio: '4:5', note: 'Classic zine page' },
  square: { label: 'Square', ratio: '1:1', note: 'Album + collage' },
  landscape: { label: 'Landscape', ratio: '16:9', note: 'Wide spread' },
  story: { label: 'Story', ratio: '9:16', note: 'Full phone screen' },
  tall: { label: 'Tall', ratio: '2:3', note: 'Poster + print' },
  wide: { label: 'Wide', ratio: '3:2', note: 'Photo spread' },
  page: { label: 'Page', ratio: 'Letter', note: 'Printable, 150dpi' },
  custom: { label: 'Custom', ratio: 'Yours', note: 'Type the numbers' },
};

// The backend clamps to this range too; the field just refuses to send nonsense.
const MIN_PAGE = 320;
const MAX_PAGE = 8192;

function clampPage(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_PAGE, Math.min(MAX_PAGE, parsed));
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function PressApp({ onClose, themeConfig, themeMode }: PressAppProps) {
  const colors = themeConfig[themeMode];
  const [issues, setIssues] = useState<PressIssue[]>([]);
  // Twenty issues a shelf.
  const issuesPage = usePaged(issues);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<IssueBundle | null>(null);
  const [activeSpreadId, setActiveSpreadId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSubtitle, setNewSubtitle] = useState('');
  const [newFormat, setNewFormat] = useState<PressFormat>('portrait');
  // Draft strings, clamped at send rather than per keystroke — clamping inside
  // onChange is what made the Studio size boxes impossible to type into.
  const [newWidth, setNewWidth] = useState('1080');
  const [newHeight, setNewHeight] = useState('1350');
  const [creating, setCreating] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [activeSaveStatus, setActiveSaveStatus] = useState<PressSaveStatus>('loading');
  const [spreadRailCollapsed, setSpreadRailCollapsed] = useState(() => {
    try {
      const stored = window.localStorage.getItem('aerie.press.spread-rail-collapsed');
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });

  const activeSpread = useMemo(
    () => bundle?.spreads.find((spread) => spread.id === activeSpreadId) || bundle?.spreads[0] || null,
    [bundle, activeSpreadId],
  );

  async function loadIssues() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/press/issues');
      if (!response.ok) throw new Error('The issue shelf would not open');
      const data = await response.json() as { issues?: PressIssue[] };
      setIssues(data.issues || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load The Press');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadIssues(); }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('aerie.press.spread-rail-collapsed', String(spreadRailCollapsed));
    } catch {
      // A private webview can deny storage; collapsing still works for the session.
    }
  }, [spreadRailCollapsed]);

  useEffect(() => { setActiveSaveStatus('loading'); }, [activeSpreadId]);

  async function openIssue(id: string) {
    setError(null);
    try {
      const response = await apiFetch(`/api/press/issues/${id}`);
      if (!response.ok) throw new Error('This issue would not open');
      const data = await response.json() as IssueBundle;
      setBundle(data);
      setActiveSpreadId(data.issue.cover_spread_id || data.spreads[0]?.id || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open this issue');
    }
  }

  async function createIssue() {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const response = await apiFetch('/api/press/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          subtitle: newSubtitle.trim(),
          format: newFormat,
          // Only sent for 'custom'; every preset lets the backend use its own defaults.
          ...(newFormat === 'custom'
            ? { pageWidth: clampPage(newWidth, 1080), pageHeight: clampPage(newHeight, 1350) }
            : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || 'Could not create issue');
      }
      const data = await response.json() as { issue: PressIssue; spreads: PressSpread[] };
      const next: IssueBundle = { issue: data.issue, spreads: data.spreads, assets: [] };
      setIssues((current) => [data.issue, ...current]);
      setBundle(next);
      setActiveSpreadId(data.spreads[0]?.id || null);
      setNewTitle('');
      setNewSubtitle('');
      setNewFormat('portrait');
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create issue');
    } finally {
      setCreating(false);
    }
  }

  async function deleteIssue(issue: PressIssue) {
    if (!window.confirm(`Delete “${issue.title}” and all of its spreads?`)) return;
    try {
      const response = await apiFetch(`/api/press/issues/${issue.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete issue');
      setIssues((current) => current.filter((item) => item.id !== issue.id));
      if (bundle?.issue.id === issue.id) setBundle(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete issue');
    }
  }

  async function createSpread() {
    if (!bundle) return;
    try {
      const response = await apiFetch(`/api/press/issues/${bundle.issue.id}/spreads`, { method: 'POST' });
      if (!response.ok) throw new Error('Could not add spread');
      const { spread } = await response.json() as { spread: PressSpread };
      setBundle((current) => current ? { ...current, spreads: [...current.spreads, spread] } : current);
      setActiveSpreadId(spread.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add spread');
    }
  }

  async function deleteSpread(spread: PressSpread) {
    if (!bundle || bundle.spreads.length <= 1) return;
    if (!window.confirm(`Delete “${spread.title}”?`)) return;
    try {
      const response = await apiFetch(`/api/press/spreads/${spread.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete spread');
      const next = bundle.spreads.filter((item) => item.id !== spread.id)
        .map((item, index) => ({ ...item, sort_order: index }));
      setBundle({ ...bundle, spreads: next });
      setActiveSpreadId(next[Math.min(spread.sort_order, next.length - 1)]?.id || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete spread');
    }
  }

  async function moveSpread(spreadId: string, direction: -1 | 1) {
    if (!bundle) return;
    const index = bundle.spreads.findIndex((spread) => spread.id === spreadId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= bundle.spreads.length) return;
    const reordered = [...bundle.spreads];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const optimistic = reordered.map((spread, sortOrder) => ({ ...spread, sort_order: sortOrder }));
    setBundle({ ...bundle, spreads: optimistic });
    try {
      const response = await apiFetch(`/api/press/issues/${bundle.issue.id}/spreads/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadIds: optimistic.map((spread) => spread.id) }),
      });
      if (!response.ok) throw new Error('Could not reorder spreads');
      const data = await response.json() as { spreads: PressSpread[] };
      setBundle((current) => current ? { ...current, spreads: data.spreads } : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reorder spreads');
      void openIssue(bundle.issue.id);
    }
  }

  function beginRename(target: RenameTarget) {
    setRenameTarget(target);
    setRenameValue(target.value);
  }

  async function saveRename() {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      const url = renameTarget.kind === 'issue'
        ? `/api/press/issues/${renameTarget.id}`
        : `/api/press/spreads/${renameTarget.id}`;
      const response = await apiFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: renameValue.trim() }),
      });
      if (!response.ok) throw new Error('Could not rename');
      if (renameTarget.kind === 'issue') {
        const { issue } = await response.json() as { issue: PressIssue };
        setBundle((current) => current ? { ...current, issue } : current);
        setIssues((current) => current.map((item) => item.id === issue.id ? issue : item));
      } else {
        const { spread } = await response.json() as { spread: PressSpread };
        setBundle((current) => current
          ? { ...current, spreads: current.spreads.map((item) => item.id === spread.id ? spread : item) }
          : current);
      }
      setRenameTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename');
    }
  }

  const modal = (showCreate || renameTarget) && (
    <div className="absolute inset-0 z-[80] flex items-end bg-black/55 p-3 backdrop-blur-sm" onClick={() => { setShowCreate(false); setRenameTarget(null); }}>
      <div
        className={cn('w-full rounded-[1.75rem] border p-4 shadow-2xl', colors.panelBg, colors.panelBorder)}
        style={{ paddingBottom: 'calc(var(--sab) + 1rem)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className={cn('text-[10px] font-bold uppercase tracking-[0.18em]', colors.textMuted)}>
              {showCreate ? 'New publication' : 'Rename'}
            </div>
            <h2 className={cn('font-serif text-xl italic', colors.textMain)}>
              {showCreate ? 'Cut the first page.' : 'Change the masthead.'}
            </h2>
          </div>
          <button className={cn('rounded-full p-2', colors.textMuted)} onClick={() => { setShowCreate(false); setRenameTarget(null); }}>
            <X size={20} />
          </button>
        </div>
        {showCreate ? (
          <div className="space-y-3">
            <input
              autoFocus
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="Issue title"
              className={cn('aerie-field w-full rounded-xl px-3 py-3 text-base outline-none', colors.textMain)}
            />
            <input
              value={newSubtitle}
              onChange={(event) => setNewSubtitle(event.target.value)}
              placeholder="Subtitle (optional)"
              className={cn('aerie-field w-full rounded-xl px-3 py-3 text-sm outline-none', colors.textMain)}
            />
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(FORMAT_COPY) as PressFormat[]).map((format) => (
                <button
                  key={format}
                  onClick={() => setNewFormat(format)}
                  aria-pressed={newFormat === format}
                  className={cn(
                    'min-h-20 rounded-xl border p-2 text-left transition-colors',
                    colors.panelBorder,
                    newFormat === format && 'ring-2',
                  )}
                  style={newFormat === format ? { borderColor: colors.accent, boxShadow: `0 0 0 2px ${colors.accent}33` } : undefined}
                >
                  <div className={cn('text-xs font-bold', colors.textMain)}>{FORMAT_COPY[format].label}</div>
                  <div className="mt-1 text-[11px] font-semibold" style={{ color: colors.accent }}>{FORMAT_COPY[format].ratio}</div>
                  <div className={cn('mt-1 text-[9px] leading-tight', colors.textMuted)}>{FORMAT_COPY[format].note}</div>
                </button>
              ))}
            </div>
            {newFormat === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  inputMode="numeric"
                  value={newWidth}
                  onChange={(event) => setNewWidth(event.target.value)}
                  onBlur={() => setNewWidth(String(clampPage(newWidth, 1080)))}
                  aria-label="Page width in pixels"
                  className={cn('aerie-field min-w-0 flex-1 rounded-xl px-3 py-3 text-base outline-none', colors.textMain)}
                />
                <span className={cn('text-sm', colors.textMuted)}>×</span>
                <input
                  inputMode="numeric"
                  value={newHeight}
                  onChange={(event) => setNewHeight(event.target.value)}
                  onBlur={() => setNewHeight(String(clampPage(newHeight, 1350)))}
                  aria-label="Page height in pixels"
                  className={cn('aerie-field min-w-0 flex-1 rounded-xl px-3 py-3 text-base outline-none', colors.textMain)}
                />
                <span className={cn('shrink-0 text-[10px]', colors.textMuted)}>px</span>
              </div>
            )}
            <button
              disabled={!newTitle.trim() || creating}
              onClick={createIssue}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl font-semibold aerie-on-accent disabled:opacity-50"
              style={{ background: colors.accent }}
            >
              {creating ? <Loader2 size={17} className="animate-spin" /> : <Newspaper size={17} />}
              Open the issue
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void saveRename(); }}
              className={cn('aerie-field w-full rounded-xl px-3 py-3 text-base outline-none', colors.textMain)}
            />
            <button
              disabled={!renameValue.trim()}
              onClick={saveRename}
              className="min-h-12 w-full rounded-xl font-semibold aerie-on-accent disabled:opacity-50"
              style={{ background: colors.accent }}
            >
              Keep it
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (bundle) {
    const activeIndex = activeSpread ? bundle.spreads.findIndex((spread) => spread.id === activeSpread.id) : -1;
    // 'clean' used to render nothing at all, which made a saved spread look identical
    // to a broken one — there is no save button on the canvas (it autosaves, and Save
    // now lives in the editor menu under File), so a silent chip left the user with no way
    // to tell saving was happening. Only 'loading' stays quiet now, because it is.
    const visibleSaveState = activeSaveStatus === 'dirty'
      ? 'Unsaved'
      : activeSaveStatus === 'saving'
        ? 'Saving…'
        : activeSaveStatus === 'error'
          ? 'Save failed'
          : activeSaveStatus === 'clean'
            ? 'Saved'
            : null;
    return (
      <AppShell
        title={bundle.issue.title}
        icon={Newspaper}
        onClose={() => { setBundle(null); void loadIssues(); }}
        themeConfig={themeConfig}
        themeMode={themeMode}
        bodyClassName="!overflow-hidden !p-0 flex flex-col"
        headerRight={
          <div className="flex items-center gap-1">
            <button
              onClick={() => beginRename({ kind: 'issue', id: bundle.issue.id, value: bundle.issue.title })}
              className={cn('rounded-full p-2', colors.textMuted)}
              title="Rename issue"
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={createSpread}
              className="rounded-full p-2 aerie-on-accent"
              style={{ background: colors.accent }}
              title="Add spread"
            >
              <Plus size={16} />
            </button>
          </div>
        }
      >
        <div className={cn('shrink-0 border-b px-2 py-1 backdrop-blur-xl', colors.panelBorder, colors.panelBg)}>
          <div className="flex min-h-9 items-center gap-1">
            <button
              onClick={() => setSpreadRailCollapsed((current) => !current)}
              className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left', colors.textMain)}
              aria-expanded={!spreadRailCollapsed}
              title={spreadRailCollapsed ? 'Open spread rail' : 'Collapse spread rail'}
            >
              <ChevronDown
                size={15}
                className={cn('shrink-0 transition-transform', spreadRailCollapsed && '-rotate-90')}
              />
              <span className="min-w-0 truncate text-[11px] font-bold">
                {activeSpread ? `${activeIndex + 1} · ${activeSpread.title}` : 'No spread selected'}
              </span>
            </button>
            {visibleSaveState && (
              <span
                className={cn(
                  'shrink-0 rounded-full border px-2 py-1 text-[9px] font-bold',
                  activeSaveStatus === 'error' ? 'border-red-400/35 bg-red-950/55 text-red-100' : colors.panelBorder,
                  activeSaveStatus !== 'error' && colors.textMuted,
                )}
              >
                {visibleSaveState}
              </span>
            )}
          </div>
          {!spreadRailCollapsed && (
            <>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                {bundle.spreads.map((spread, index) => {
                  const selected = spread.id === activeSpread?.id;
                  return (
                    <button
                      key={spread.id}
                      onClick={() => setActiveSpreadId(spread.id)}
                      className={cn(
                        'group flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-left transition-colors',
                        colors.panelBorder,
                        selected ? 'aerie-on-accent' : colors.textMain,
                      )}
                      style={selected ? { background: colors.accent, borderColor: colors.accent } : undefined}
                    >
                      <GripVertical size={11} className="opacity-45" />
                      <div>
                        <div className="text-[8px] font-bold uppercase tracking-[0.12em] opacity-65">{index + 1}</div>
                        <div className="max-w-24 truncate text-[11px] font-semibold">{spread.title}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {activeSpread && (
                <div className="flex min-h-8 items-center justify-center gap-1 border-t border-current/5 pt-0.5">
                  <button
                    disabled={activeIndex <= 0}
                    onClick={() => moveSpread(activeSpread.id, -1)}
                    className={cn('rounded-lg p-1.5 disabled:opacity-25', colors.textMuted)}
                    title="Move spread left"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    disabled={activeIndex < 0 || activeIndex >= bundle.spreads.length - 1}
                    onClick={() => moveSpread(activeSpread.id, 1)}
                    className={cn('rounded-lg p-1.5 disabled:opacity-25', colors.textMuted)}
                    title="Move spread right"
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    onClick={() => beginRename({ kind: 'spread', id: activeSpread.id, value: activeSpread.title })}
                    className={cn('rounded-lg p-1.5', colors.textMuted)}
                    title="Rename spread"
                  >
                    <Pencil size={13} />
                  </button>
                  <span className={cn('min-w-0 max-w-44 truncate px-2 text-center text-[10px] font-semibold', colors.textMuted)}>
                    {activeSpread.title}
                  </span>
                  <button
                    disabled={bundle.spreads.length <= 1}
                    onClick={() => deleteSpread(activeSpread)}
                    className={cn('rounded-lg p-1.5 disabled:opacity-25', colors.textMuted)}
                    title="Delete spread"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="relative min-h-0 flex-1">
          {activeSpread ? (
            <Suspense fallback={<div className={cn('flex h-full items-center justify-center gap-2 text-sm', colors.textMuted)}><Loader2 size={18} className="animate-spin" />Loading the cutting table…</div>}>
              <PressEditor
                key={activeSpread.id}
                issue={bundle.issue}
                spread={activeSpread}
                assets={bundle.assets}
                themeConfig={themeConfig}
                themeMode={themeMode}
                onSaveStatusChange={setActiveSaveStatus}
                onSpreadSaved={(saved) => setBundle((current) => current
                  ? { ...current, spreads: current.spreads.map((item) => item.id === saved.id ? saved : item) }
                  : current)}
                onAssetChanged={(asset) => setBundle((current) => current
                  ? { ...current, assets: [...current.assets.filter((item) => item.id !== asset.id), asset] }
                  : current)}
              />
            </Suspense>
          ) : (
            <div className={cn('flex h-full items-center justify-center text-sm', colors.textMuted)}>No spread selected.</div>
          )}
        </div>
        {error && <div className="absolute bottom-4 left-4 right-4 z-[70] rounded-xl bg-red-950/90 px-4 py-3 text-xs text-red-100 shadow-xl">{error}</div>}
        {modal}
      </AppShell>
    );
  }

  return (
    <AppShell
      title="The Press"
      icon={Newspaper}
      onClose={onClose}
      themeConfig={themeConfig}
      themeMode={themeMode}
      headerRight={
        <div className="flex items-center gap-1">
          <button onClick={loadIssues} className={cn('rounded-full p-2', colors.textMuted)} title="Refresh">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
          <button onClick={() => setShowCreate(true)} className="aerie-on-accent rounded-full p-2" style={{ background: colors.accent }} title="New issue">
            <Plus size={16} />
          </button>
        </div>
      }
    >
      <section className="mb-4 px-1 pt-1">
        <div className={cn('max-w-md rounded-[1.35rem] border px-4 py-3 shadow-xl backdrop-blur-xl', colors.panelBg, colors.panelBorder)}>
          <div className={cn('text-[9px] font-bold uppercase tracking-[0.2em]', colors.textMuted)}>Aerie publishing house</div>
          <h2 className={cn('mt-1 font-serif text-[1.55rem] italic leading-[0.94]', colors.textMain)}>Cut it apart.<br />Make it mean something.</h2>
          <p className={cn('mt-2 text-[11px] leading-relaxed', colors.textMuted)}>
          Editable zines, crooked tape, real torn edges, and every relic the house has collected.
          </p>
        </div>
      </section>

      {error && <div className="mb-3 rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-2 text-xs text-red-200">{error}</div>}

      {loading ? (
        <div className={cn('flex min-h-48 items-center justify-center gap-2 text-sm', colors.textMuted)}>
          <Loader2 size={18} className="animate-spin" /> Opening the flat files…
        </div>
      ) : issues.length === 0 ? (
        <button
          onClick={() => setShowCreate(true)}
          className={cn('flex min-h-64 w-full flex-col items-center justify-center rounded-[2rem] border border-dashed p-6 text-center', colors.panelBorder, colors.panelBg)}
        >
          <BookOpen size={34} style={{ color: colors.accent }} />
          <div className={cn('mt-4 font-serif text-xl italic', colors.textMain)}>The first issue is waiting.</div>
          <div className={cn('mt-2 text-xs', colors.textMuted)}>Tap to cut the first page.</div>
        </button>
      ) : (
            <>
        <div className="grid grid-cols-2 gap-3 pb-8 sm:grid-cols-3">
          {issuesPage.visible.map((issue, index) => (
            <article
              key={issue.id}
              className={cn('group relative aspect-[4/5] overflow-hidden rounded-[1.35rem] border shadow-lg', colors.panelBg, colors.panelBorder)}
            >
              {/* The spread itself, exported small when it was last saved. Asked for at
                  a thumbnail width so a shelf of issues is kilobytes, not megabytes. */}
              {issue.cover_thumbnail_file_id && (
            <>
                  <img
                    src={thumbSrc(`/api/files/${issue.cover_thumbnail_file_id}`, 480)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  {/* The card's own words sit on top of the user's artwork, so they need a floor. */}
                  <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/25" />
            </>
              )}
              <button onClick={() => openIssue(issue.id)} className="absolute inset-0 flex w-full flex-col p-3 text-left">
                <div className="flex items-start justify-between">
                  <span className="px-2 py-1 text-[8px] font-black uppercase tracking-[0.22em]" style={{ background: 'color-mix(in srgb, var(--aerie-text) 90%, transparent)', color: 'var(--aerie-page)' }}>The Press</span>
                  <span className={cn('text-[9px] font-bold uppercase tracking-[0.14em]', colors.textMuted)}>
                    {/* A custom page has no ratio worth naming, so it wears its own numbers. */}
                    {issue.format === 'custom' || !FORMAT_COPY[issue.format]
                      ? `${issue.page_width}×${issue.page_height}`
                      : FORMAT_COPY[issue.format].ratio}
                  </span>
                </div>
                <div className="mt-auto rotate-[-1deg]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.18em]" style={{ color: colors.accent }}>Issue {String(index + 1).padStart(2, '0')}</div>
                  <h3 className={cn('mt-1 line-clamp-3 font-serif text-xl italic leading-[0.95]', colors.textMain)}>{issue.title}</h3>
                  {issue.subtitle && <p className={cn('mt-2 line-clamp-2 text-[9px] leading-tight', colors.textMuted)}>{issue.subtitle}</p>}
                  {/* pr-9 keeps the date clear of the delete button, which is absolutely
                      positioned at bottom-right on top of this row. On desktop the button
                      is invisible until hover so the overlap never showed; on a phone it
                      is always visible, and it was sitting on the date. */}
                  <div className={cn('mt-3 flex items-center justify-between border-t pt-2 pr-9 text-[9px]', colors.panelBorder, colors.textMuted)}>
                    <span>{issue.spread_count || 0} {(issue.spread_count || 0) === 1 ? 'spread' : 'spreads'}</span>
                    <span>{formatDate(issue.updated_at)}</span>
                  </div>
                </div>
              </button>
              <button
                onClick={() => deleteIssue(issue)}
                /* Big invisible hit area, small visible disc — the same shape the
                   Studio reference drawers use. The circle used to BE the button, so
                   shrinking it would have shrunk the thing the user's thumb has to find. */
                className="absolute bottom-0 right-0 z-10 flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-white/70 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                title="Delete issue"
                aria-label={`Delete ${issue.title}`}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55 backdrop-blur">
                  <Trash2 size={12} />
                </span>
              </button>
            </article>
          ))}
        </div>
        <Paginator page={issuesPage.page} pageCount={issuesPage.pageCount} onPage={issuesPage.setPage} colors={colors} />
            </>
      )}
      {modal}
    </AppShell>
  );
}
