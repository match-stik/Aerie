// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React, { useEffect, useRef, useState } from 'react';
import { Plug, Loader2 } from 'lucide-react';
import { AppShell } from './AppShell';
import { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';
import { openExternal } from '../lib/open-external';
import { SecretInput } from './SecretInput';
import { apiFetch } from '../aerie';

interface ProvidersAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
  embedded?: boolean;
}

const MASK = '••••••••';

// API-key providers behind the runtime router — alphabetized.
//
// OpenAI is deliberately absent: this house reaches it through Codex, which
// authenticates in the browser and stores no key. The field only ever offered
// a second, unused way in. The backend still honours a providers.openai key if
// one is ever set by hand — this just stops the UI asking for one.
const API_PROVIDERS: { key: string; name: string; tag: 'free' | 'paid'; placeholder: string; hint: string }[] = [
  { key: 'anthropic', name: 'Anthropic', tag: 'paid', placeholder: 'sk-ant-…', hint: 'console.anthropic.com (optional — the Claude lane uses your Claude Code login)' },
  { key: 'groq', name: 'Groq', tag: 'free', placeholder: 'gsk_…', hint: 'console.groq.com' },
  { key: 'huggingface', name: 'HuggingFace', tag: 'free', placeholder: 'hf_…', hint: 'huggingface.co/settings/tokens' },
  { key: 'openrouter', name: 'OpenRouter', tag: 'paid', placeholder: 'sk-or-…', hint: 'openrouter.ai/keys' },
  { key: 'xai', name: 'xAI', tag: 'paid', placeholder: 'xai-…', hint: 'console.x.ai' },
];

interface CodexStatus {
  loggedIn?: boolean;
  expiresAt?: number | null;
  loginSession?: { status?: string; url?: string; error?: string };
}

export function ProvidersApp({ onClose, themeConfig, themeMode, embedded }: ProvidersAppProps) {
  const colors = themeConfig[themeMode];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [ollamaUrl, setOllamaUrl] = useState('');
  const [ollamaKey, setOllamaKey] = useState('');
  const [keys, setKeys] = useState<Record<string, string>>({});

  const [codex, setCodex] = useState<CodexStatus | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [codexBusy, setCodexBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadProviders() {
    try {
      const res = await apiFetch('/api/preferences');
      if (!res.ok) throw new Error('Failed to load');
      const prefs = await res.json();
      const p = prefs.providers || {};
      setOllamaUrl(p.ollama?.base_url || '');
      setOllamaKey(p.ollama?.api_key ? MASK : '');
      const k: Record<string, string> = {};
      for (const prov of API_PROVIDERS) k[prov.key] = p[prov.key]?.api_key ? MASK : '';
      setKeys(k);
    } catch {
      setError('Failed to load provider settings');
    } finally {
      setLoading(false);
    }
  }

  async function loadCodex() {
    try {
      const res = await apiFetch('/api/auth/codex/status');
      if (res.ok) setCodex(await res.json());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadProviders();
    loadCodex();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function saveProviders() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const providerUpdates: Record<string, unknown> = {};
      if (ollamaUrl) {
        const ollama: Record<string, string> = { base_url: ollamaUrl };
        if (ollamaKey && !ollamaKey.startsWith('•')) ollama.api_key = ollamaKey;
        providerUpdates.ollama = ollama;
      }
      for (const prov of API_PROVIDERS) {
        const v = keys[prov.key];
        if (v && !v.startsWith('•')) providerUpdates[prov.key] = { api_key: v };
      }
      const res = await apiFetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: providerUpdates }),
      });
      const data = await res.json();
      if (res.ok) setMessage('Saved. Restart the server for changes to take effect.');
      else setError(data.error || 'Failed to save');
    } catch {
      setError('Failed to save provider settings');
    } finally {
      setSaving(false);
    }
  }

  function startCodexPoll() {
    if (pollRef.current) clearInterval(pollRef.current);
    let ticks = 0;
    pollRef.current = setInterval(async () => {
      ticks += 1;
      await loadCodex();
      if (ticks > 40) {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 3000);
  }

  async function codexLogin() {
    setCodexBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/auth/codex/login', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        startCodexPoll();
        await loadCodex();
      } else {
        setError('Codex login failed to produce a URL.');
      }
    } catch {
      setError('Codex login failed');
    } finally {
      setCodexBusy(false);
    }
  }

  async function codexManualCode() {
    if (!manualCode.trim()) return;
    setCodexBusy(true);
    try {
      await apiFetch('/api/auth/codex/manual-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: manualCode.trim() }),
      });
      setManualCode('');
      await loadCodex();
    } catch {
      setError('Manual code submission failed');
    } finally {
      setCodexBusy(false);
    }
  }

  async function codexLogout() {
    setCodexBusy(true);
    try {
      await apiFetch('/api/auth/codex/logout', { method: 'POST' });
      await loadCodex();
    } finally {
      setCodexBusy(false);
    }
  }

  const card = cn('rounded-2xl border p-3 mb-3', colors.panelBg, colors.panelBorder);
  const fieldLabel = cn('text-[11px] mb-1', colors.textMuted);
  const input = cn('w-full rounded-lg border px-2.5 py-2 text-xs bg-transparent', colors.panelBorder, colors.textMain);

  function tag(t: 'free' | 'paid') {
    return (
      <span
        className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
        style={{
          background: `${colors.accent}22`,
          color: colors.accent,
          opacity: t === 'free' ? 1 : 0.8,
        }}
      >
        {t === 'free' ? 'free tier' : 'credits'}
      </span>
    );
  }

  const codexLoggedIn = !!codex?.loggedIn;
  const codexInFlight = codex?.loginSession?.status === 'awaiting_browser';

  return (
    <AppShell embedded={embedded} title="Providers" icon={Plug} onClose={onClose} themeConfig={themeConfig} themeMode={themeMode}>
      {loading ? (
        <div className={cn('rounded-2xl border p-3 backdrop-blur-md text-xs py-6 text-center', colors.panelBg, colors.panelBorder, colors.textMuted)}>Loading providers…</div>
      ) : (
        <>
          {/* Codex — moved to top */}
          <div className={cn('rounded-2xl border p-3 backdrop-blur-md mb-3', colors.panelBg, colors.panelBorder)}>
            <div className="flex items-center justify-between mb-2">
              <span className={cn('text-sm font-semibold', colors.textMain)}>Codex (ChatGPT)</span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: `${colors.accent}${codexLoggedIn || codexInFlight ? '26' : '00'}`,
                  color: codexLoggedIn || codexInFlight ? colors.accent : colors.textMuted,
                  opacity: codexLoggedIn ? 1 : codexInFlight ? 0.7 : 0.5,
                }}
              >
                {codexLoggedIn ? 'Logged in' : codexInFlight ? 'Login in progress' : 'Not logged in'}
              </span>
            </div>
            {codexLoggedIn ? (
              <button
                onClick={codexLogout}
                disabled={codexBusy}
                className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                style={{ color: colors.accent, borderColor: colors.accent }}
              >
                Log out
              </button>
            ) : (
              <>
                <button
                  onClick={codexLogin}
                  disabled={codexBusy}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold aerie-on-accent disabled:opacity-50 flex items-center gap-1.5"
                  style={{ background: colors.accent }}
                >
                  {codexBusy && <Loader2 size={12} className="animate-spin" />} Log in with ChatGPT
                </button>
                {codex?.loginSession?.url && (
                  <a
                    href={codex.loginSession.url}
                    rel="noopener noreferrer"
                    onClick={(e) => { e.preventDefault(); void openExternal(codex.loginSession!.url!); }}
                    className="block text-[11px] mt-2"
                    style={{ color: colors.accent }}
                  >
                    Reopen login URL
                  </a>
                )}
                <div className={cn(fieldLabel, 'mt-2')}>Or paste the code from the browser</div>
                <div className="flex gap-2">
                  <input
                    className={cn(input, 'flex-1')}
                    type="text"
                    placeholder="Authorization code"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                  />
                  <button
                    onClick={codexManualCode}
                    disabled={codexBusy || !manualCode.trim()}
                    className={cn('rounded-lg border px-3 text-xs font-semibold disabled:opacity-50', colors.panelBorder, colors.textMain)}
                  >
                    Submit
                  </button>
                </div>
              </>
            )}
            {codex?.loginSession?.error && (
              <p className="text-[11px] mt-2" style={{ color: colors.accent, opacity: 0.8 }}>{codex.loginSession.error}</p>
            )}
          </div>

          {/* All providers in one panel */}
          <div className={cn('rounded-2xl border p-3 backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
            <p className={cn('text-xs mb-3', colors.textMuted)}>
              Connect inference backends. Add an API key to enable a provider — its models appear in the model selector.
            </p>

            {/* Ollama */}
            <div className={cn('rounded-xl border p-3 mb-2', colors.panelBorder)}>
              <div className="flex items-center gap-2 mb-2">
                <span className={cn('text-sm font-semibold', colors.textMain)}>Ollama</span>
                {tag('free')}
              </div>
              <div className={fieldLabel}>Base URL</div>
              <input
                className={input}
                type="text"
                placeholder="http://localhost:11434 or https://ollama.com"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
              />
              <div className={cn(fieldLabel, 'mt-2')}>API Key</div>
              <SecretInput
                className={input}
                placeholder="Optional — for Ollama Cloud"
                value={ollamaKey}
                onChange={(e) => setOllamaKey(e.target.value)}
              />
            </div>

            {/* API-key providers */}
            {API_PROVIDERS.map((prov) => (
              <div key={prov.key} className={cn('rounded-xl border p-3 mb-2 last:mb-0', colors.panelBorder)}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn('text-sm font-semibold', colors.textMain)}>{prov.name}</span>
                  {tag(prov.tag)}
                </div>
                <div className={fieldLabel}>API Key</div>
                <SecretInput
                  className={input}
                  placeholder={prov.placeholder}
                  value={keys[prov.key] || ''}
                  onChange={(e) => setKeys((k) => ({ ...k, [prov.key]: e.target.value }))}
                />
                <div className={cn('text-[10px] mt-1', colors.textMuted)}>{prov.hint}</div>
              </div>
            ))}

            {message && <p className="text-xs mt-3" style={{ color: colors.accent }}>{message}</p>}
            {error && <p className="text-xs mt-3" style={{ color: colors.accent, opacity: 0.8 }}>{error}</p>}

            <button
              onClick={saveProviders}
              disabled={saving}
              className="w-full rounded-xl py-2.5 text-sm font-semibold aerie-on-accent disabled:opacity-50 mt-3"
              style={{ background: colors.accent }}
            >
              {saving ? 'Saving…' : 'Save Providers'}
            </button>
          </div>
        </>
      )}
    </AppShell>
  );
}
