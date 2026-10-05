// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React, { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { AppShell } from './AppShell';
import { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';
import { apiFetch } from '../aerie';

interface PreferencesAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
  embedded?: boolean;
}

type WarmRouting = 'cli' | 'codex-cli';

interface ModelChoice {
  id: string;
  label: string;
  routing: WarmRouting;
}

interface DiscoveredModel {
  id: string;
  name: string;
  provider: string;
}

// The live list comes from /api/models. Keep a small fallback so model
// settings remain usable if discovery is briefly unavailable.
const FALLBACK_MODELS: ModelChoice[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', routing: 'cli' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', routing: 'cli' },
  { id: 'claude-fable-5', label: 'Claude Fable 5', routing: 'cli' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', routing: 'cli' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', routing: 'cli' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', routing: 'cli' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', routing: 'codex-cli' },
  { id: 'gpt-6-sol', label: 'GPT-6 Sol', routing: 'codex-cli' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', routing: 'codex-cli' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', routing: 'codex-cli' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', routing: 'codex-cli' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', routing: 'codex-cli' },
];

const THINKING_MODES = [
  { id: 'disabled', label: 'Disabled' },
  { id: 'adaptive', label: 'Adaptive' },
  { id: 'enabled', label: 'Always' },
];

const EFFORT_LEVELS = [
  { id: 'adaptive', label: 'Adaptive' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'XHigh' },
  { id: 'max', label: 'Max' },
];

const CODEX_EFFORT_LEVELS = [
  { id: 'adaptive', label: 'Model Default' },
  { id: 'low', label: 'Light' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra High' },
  { id: 'max', label: 'Max' },
  { id: 'ultra', label: 'Ultra' },
];

const CODEX_SPEEDS = [
  { id: 'standard', label: 'Standard' },
  { id: 'fast', label: 'Fast' },
];

// Only bites on threads holding more than one companion; a solo thread has
// always had its own lane either way.
const ROOM_MODES = [
  { id: 'false', label: 'One Shared Lane' },
  { id: 'true', label: 'A Lane Each' },
];

const TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata',
  'Australia/Sydney', 'Pacific/Auckland',
];

export function PreferencesApp({ onClose, themeConfig, themeMode, embedded }: PreferencesAppProps) {
  const colors = themeConfig[themeMode];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [companionName, setCompanionName] = useState('');
  const [userName, setUserName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [model, setModel] = useState('');
  const [modelAutonomous, setModelAutonomous] = useState('');
  const [modelPulse, setModelPulse] = useState('');
  const [routing, setRouting] = useState('sdk');
  const [routingAutonomous, setRoutingAutonomous] = useState('cli');
  const [modelChoices, setModelChoices] = useState<ModelChoice[]>(FALLBACK_MODELS);
  const [claudeThinking, setClaudeThinking] = useState('adaptive');
  const [claudeEffort, setClaudeEffort] = useState('adaptive');
  const [codexEffort, setCodexEffort] = useState('adaptive');
  const [codexSpeed, setCodexSpeed] = useState('standard');
  // 'false' = every companion in a thread answers out of one shared warm lane.
  // 'true'  = each gets their own lane and the turn is passed between them.
  const [multiLane, setMultiLane] = useState('false');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/preferences');
        if (!res.ok) throw new Error('load failed');
        const p = await res.json();
        setCompanionName(p.identity?.companion_name || '');
        setUserName(p.identity?.user_name || '');
        setTimezone(p.identity?.timezone || 'UTC');
        setModel(p.agent?.model || '');
        setModelAutonomous(p.agent?.model_autonomous || '');
        setModelPulse(p.agent?.model_pulse || 'claude-haiku-4-5');
        setRouting(p.agent?.routing || 'sdk');
        setRoutingAutonomous(p.agent?.routing_autonomous || p.agent?.routing || 'sdk');
        setClaudeThinking(p.agent?.claude_thinking || p.agent?.thinking || 'adaptive');
        setClaudeEffort(p.agent?.claude_effort || p.agent?.effort || 'adaptive');
        setCodexEffort(p.agent?.codex_effort || p.agent?.effort || 'adaptive');
        setCodexSpeed(p.agent?.codex_speed || 'standard');
        setMultiLane(p.agent?.multi_lane === true ? 'true' : 'false');

        // Wakes use a dedicated warm lane. Only show the two warm providers
        // here so selecting a model also selects a compatible route.
        void apiFetch('/api/models').then(async (modelRes) => {
          if (!modelRes.ok) return;
          const discovered = await modelRes.json() as DiscoveredModel[];
          const warm = discovered
            .filter((m) => m.provider === 'claude-cli' || m.provider === 'codex-cli')
            .map((m) => ({
              id: m.id,
              label: m.name.replace(/\s+\(Warm\)$/i, ''),
              routing: (m.provider === 'claude-cli' ? 'cli' : 'codex-cli') as WarmRouting,
            }));
          if (warm.length > 0) setModelChoices(warm);
        }).catch(() => {
          // Keep fallback choices; preferences themselves still loaded.
        });
      } catch {
        setError('Failed to load preferences');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const updates: Record<string, unknown> = {
        identity: { companion_name: companionName, user_name: userName, timezone },
        agent: {
          model, model_autonomous: modelAutonomous, model_pulse: modelPulse,
          routing, routing_autonomous: routingAutonomous,
          claude_thinking: claudeThinking, claude_effort: claudeEffort,
          codex_effort: codexEffort, codex_speed: codexSpeed,
          multi_lane: multiLane === 'true',
        },
      };
      const res = await apiFetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message || 'Saved. Restart the server for changes to take effect.');
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch {
      setError('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  }

  const card = cn('rounded-2xl border p-3 mb-3', colors.panelBg, colors.panelBorder);
  const title = cn('text-[11px] font-bold uppercase tracking-[0.12em] mb-2', colors.textMuted);
  const label = cn('text-[11px] mb-1', colors.textMuted);
  const input = cn('w-full rounded-lg border px-2.5 py-2 text-sm bg-transparent', colors.panelBorder, colors.textMain);

  function modelSelect(
    label: string,
    value: string,
    onChange: (v: string) => void,
    hint: string,
    onRouteChange?: (route: WarmRouting) => void,
  ) {
    const claude = modelChoices.filter((m) => m.routing === 'cli');
    const codex = modelChoices.filter((m) => m.routing === 'codex-cli');
    return (
      <label className="flex flex-col gap-1">
        <span className={cn('text-[11px]', colors.textMuted)}>{label}</span>
        <select
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next);
            const choice = modelChoices.find((m) => m.id === next);
            if (choice && onRouteChange) onRouteChange(choice.routing);
          }}
          className={input}
        >
          {!modelChoices.some((m) => m.id === value) && value && <option value={value}>{value}</option>}
          <optgroup label="Claude">
            {claude.map((m) => <option key={`cli:${m.id}`} value={m.id}>{m.label}</option>)}
          </optgroup>
          <optgroup label="Codex">
            {codex.map((m) => <option key={`codex-cli:${m.id}`} value={m.id}>{m.label}</option>)}
          </optgroup>
        </select>
        <span className={cn('text-[10px]', colors.textMuted)}>{hint}</span>
      </label>
    );
  }

  function chips(options: { id: string; label: string }[], value: string, onChange: (v: string) => void) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={cn('rounded-lg border px-2.5 py-1.5 text-xs', colors.panelBorder)}
            style={value === o.id ? { background: colors.accent, color: 'var(--aerie-on-accent)' } : { color: 'var(--aerie-text)' }}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }

  if (loading) {
    return (
      <AppShell embedded={embedded} title="Preferences" icon={SlidersHorizontal} onClose={onClose} themeConfig={themeConfig} themeMode={themeMode}>
        <div className={cn('text-xs py-6 text-center', colors.textMuted)}>Loading preferences…</div>
      </AppShell>
    );
  }

  return (
    <AppShell embedded={embedded} title="Preferences" icon={SlidersHorizontal} onClose={onClose} themeConfig={themeConfig} themeMode={themeMode}>
      {/* Identity */}
      <div className={card}>
        <div className={title}>Identity</div>
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1">
            <span className={label}>Companion name</span>
            <input className={input} value={companionName} onChange={(e) => setCompanionName(e.target.value)} placeholder="Echo" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Your name</span>
            <input className={input} value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Alex" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Timezone</span>
            <select className={input} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {!TIMEZONES.includes(timezone) && <option value={timezone}>{timezone}</option>}
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Agent */}
      <div className={card}>
        <div className={title}>Agent — Models</div>
        <div className="flex flex-col gap-2.5">
          {modelSelect('Interactive', model, setModel, 'Your messages', setRouting)}
          {modelSelect('Wakes', modelAutonomous, setModelAutonomous, 'Scheduled and spontaneous wakes', setRoutingAutonomous)}
          {modelSelect('Failsafe', modelPulse, setModelPulse, 'Background silence checks')}
        </div>
        <div className={cn(title, 'mt-3')}>Claude — Thinking Mode</div>
        {chips(THINKING_MODES, claudeThinking, setClaudeThinking)}
        <div className={cn(title, 'mt-3')}>Claude — Effort</div>
        {chips(EFFORT_LEVELS, claudeEffort, setClaudeEffort)}
        <div className={cn(title, 'mt-3')}>Codex — Thinking</div>
        {chips(CODEX_EFFORT_LEVELS, codexEffort, setCodexEffort)}
        <div className={cn(title, 'mt-3')}>Codex — Speed</div>
        {chips(CODEX_SPEEDS, codexSpeed, setCodexSpeed)}

        {/* How a thread with more than one companion in it actually runs. */}
        <div className={cn(title, 'mt-3')}>The Room</div>
        {chips(ROOM_MODES, multiLane, setMultiLane)}
        <p className={cn('text-[10px] mt-1.5', colors.textMuted)}>
          {multiLane === 'true'
            ? 'Each companion answers from their own warm lane. The turn passes between them in a shuffled order and each one hears what the others already said. Separate heads, same room.'
            : 'Everyone in a thread answers out of one shared lane — one context, all voices, no waiting.'}
        </p>

        {message &&<p className="text-xs mt-3" style={{ color: colors.accent }}>{message}</p>}
        {error && <p className="text-xs mt-3" style={{ color: colors.accent, opacity: 0.8 }}>{error}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="w-full rounded-xl py-2.5 text-sm font-semibold aerie-on-accent disabled:opacity-50 mt-3"
          style={{ background: colors.accent }}
        >
          {saving ? 'Saving…' : 'Save Preferences'}
        </button>
      </div>
    </AppShell>
  );
}
