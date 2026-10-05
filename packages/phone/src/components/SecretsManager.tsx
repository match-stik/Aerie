// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { apiFetch } from '../aerie';
import type { ThemeConfig } from '../lib/theme';
import { SecretInput } from './SecretInput';

interface SecretStatus {
  name: string;
  label: string;
  category: 'voice' | 'platform' | 'integration' | 'provider';
  hasValue: boolean;
  placeholder?: string;
  hint?: string;
}

interface SecretsManagerProps {
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

const CATEGORY_ORDER: SecretStatus['category'][] = ['voice', 'platform', 'provider', 'integration'];
const CATEGORY_LABEL: Record<SecretStatus['category'], string> = {
  voice: 'Voice',
  platform: 'Platforms',
  provider: 'Model Router',
  integration: 'Other Services',
};

// BYOK editor for every server-managed API key / token / URL. Reads the
// list from GET /api/secrets (status only, no values) and writes via
// PUT/DELETE /api/secrets/:name. The backend re-initializes the
// affected service in place so changes take effect without a restart.
export function SecretsManager({ themeConfig, themeMode }: SecretsManagerProps) {
  const colors = themeConfig[themeMode];

  const [secrets, setSecrets] = useState<SecretStatus[]>([]);
  const [orphanVoiceIds, setOrphanVoiceIds] = useState<Array<{ name: string; slug: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch('/api/secrets');
      if (!res.ok) throw new Error(`Load failed: ${res.status}`);
      const data = await res.json();
      setSecrets(Array.isArray(data.secrets) ? data.secrets : []);
      // Pull the orphan voice-ID secrets (entries whose companion was
      // never registered or got renamed). Anything that ISN'T registered
      // is fair game to delete from here.
      try {
        const orphanRes = await apiFetch('/api/secrets/voice-ids/all');
        if (orphanRes.ok) {
          const orphanData = await orphanRes.json();
          const rows = Array.isArray(orphanData.rows) ? orphanData.rows : [];
          setOrphanVoiceIds(
            rows
              .filter((r: { registered: boolean }) => !r.registered)
              .map((r: { name: string; slug: string }) => ({ name: r.name, slug: r.slug })),
          );
        }
      } catch { /* non-fatal */ }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(name: string) {
    const value = drafts[name];
    if (!value || !value.trim()) return;
    setBusy(name);
    try {
      const res = await apiFetch(`/api/secrets/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: value.trim() }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setDrafts((d) => {
        const next = { ...d };
        delete next[name];
        return next;
      });
      setSecrets((prev) => prev.map((s) => (s.name === name ? { ...s, hasValue: true } : s)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  }

  async function clear(name: string) {
    setBusy(name);
    try {
      const res = await apiFetch(`/api/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Clear failed: ${res.status}`);
      setDrafts((d) => {
        const next = { ...d };
        delete next[name];
        return next;
      });
      setSecrets((prev) => prev.map((s) => (s.name === name ? { ...s, hasValue: false } : s)));
      setOrphanVoiceIds((prev) => prev.filter((o) => o.name !== name));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clear failed');
    } finally {
      setBusy(null);
    }
  }

  const grouped = useMemo(() => {
    const groups: Record<string, SecretStatus[]> = {};
    for (const s of secrets) {
      if (!groups[s.category]) groups[s.category] = [];
      groups[s.category].push(s);
    }
    return CATEGORY_ORDER.filter((c) => groups[c]?.length).map((c) => ({ category: c, items: groups[c] }));
  }, [secrets]);

  const card = cn('p-4 rounded-2xl border', colors.panelBg, colors.panelBorder);

  return (
    <div className="space-y-5">
      {/* Description panel */}
      <div className={cn('rounded-2xl border p-3 backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
        <p className={cn('text-xs', colors.textMuted)}>
          Manage API keys and tokens for connected services. Changes take effect immediately.
        </p>
      </div>

      {loading && (
        <div className={cn('rounded-2xl border p-3 backdrop-blur-md flex items-center justify-center gap-2 py-6 text-xs', colors.panelBg, colors.panelBorder, colors.textMuted)}>
          <Loader2 size={14} className="animate-spin" /> Loading secrets…
        </div>
      )}

      {error && (
        <p className="text-xs" style={{ color: colors.accent }}>
          {error}
        </p>
      )}

      {grouped.map((group) => (
        <section key={group.category} className={cn('rounded-2xl border p-3 backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
          <h3 className={cn('text-[11px] font-bold uppercase tracking-[0.12em] mb-3', colors.textMuted)} style={{ color: colors.accent }}>{CATEGORY_LABEL[group.category]}</h3>
          <div className="space-y-2">
            {group.items.map((s) => {
              const draft = drafts[s.name] ?? '';
              const hasDraft = draft.length > 0;
              const rowBusy = busy === s.name;
              return (
                <div key={s.name} className={card}>
                  <div className="flex items-center justify-between mb-1">
                    <label className={cn('text-xs font-medium', colors.textMain)}>{s.label}</label>
                    {s.hasValue && !hasDraft && (
                      <span className={cn('text-[10px] uppercase tracking-wider', colors.textMuted)} style={{ color: colors.accent }}>
                        Saved
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <SecretInput
                      value={draft}
                      placeholder={s.hasValue ? '••••••••  (saved — type to replace)' : s.placeholder || 'Not set'}
                      onChange={(e) => setDrafts((d) => ({ ...d, [s.name]: e.target.value }))}
                      className={cn(
                        'flex-1 bg-transparent focus:outline-none text-xs px-2 py-1.5 rounded-md border',
                        colors.panelBorder,
                        colors.textMain,
                      )}
                    />
                    {hasDraft && (
                      <button
                        onClick={() => save(s.name)}
                        disabled={rowBusy}
                        className="rounded-md px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                        style={{ background: colors.accent, color: 'var(--aerie-on-accent)' }}
                      >
                        {rowBusy ? <Loader2 size={11} className="animate-spin inline" /> : 'Save'}
                      </button>
                    )}
                    {s.hasValue && !hasDraft && (
                      <button
                        onClick={() => clear(s.name)}
                        disabled={rowBusy}
                        className={cn('rounded-md p-1.5', colors.textMuted, 'hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40')}
                        style={{ color: colors.accent }}
                        title="Clear"
                      >
                        {rowBusy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    )}
                  </div>
                  {s.hint && (
                    <p className={cn('text-[10px] mt-1 opacity-70', colors.textMuted)}>{s.hint}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {orphanVoiceIds.length > 0 && (
        <section className={cn('rounded-2xl border p-3 backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
          <h3 className={cn('text-[11px] font-bold uppercase tracking-[0.12em] mb-2', colors.textMuted)} style={{ color: colors.accent }}>Orphan voice IDs</h3>
          <p className={cn('text-[10px] leading-relaxed mb-3', colors.textMuted)}>
            These voice IDs belong to companions that aren't registered anymore.
            Safe to delete — they aren't routing to anything.
          </p>
          <div className="space-y-2">
            {orphanVoiceIds.map((o) => {
              const rowBusy = busy === o.name;
              return (
                <div key={o.name} className={card}>
                  <div className="flex items-center justify-between">
                    <span className={cn('text-xs', colors.textMain)}>{o.slug}</span>
                    <button
                      onClick={() => clear(o.name)}
                      disabled={rowBusy}
                      className={cn('rounded-md p-1.5', 'hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40')}
                      style={{ color: colors.accent }}
                      title="Delete orphan voice ID"
                    >
                      {rowBusy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!loading && secrets.length === 0 && !error && (
        <div className={cn('rounded-2xl border p-3 backdrop-blur-md text-center', colors.panelBg, colors.panelBorder)}>
          <p className={cn('text-xs py-3 italic', colors.textMuted)}>
            No secrets defined.
          </p>
        </div>
      )}
    </div>
  );
}
