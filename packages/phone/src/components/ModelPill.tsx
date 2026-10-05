// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronRight, Plus, Star, X, Loader2, Wrench } from 'lucide-react';
import { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';
import { apiFetch } from '../aerie';
import { clearProviderScopedState } from '../aerie/socket';
import { isModelSwitch } from './model-switch';
import { modelLabel } from '../lib/model-label';

interface ModelPillProps {
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

/** A warm lane, what it is launched on, and any id the CLI refused it. */
interface LaneModelState {
  key: string;
  running: string;
  refused: string[];
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  tier: 'free' | 'paid' | 'included' | 'local';
  description?: string;
  context_length?: number;
  supports_tools?: boolean;
  reasoning_levels?: string[];
  default_reasoning_level?: string;
  speed_tiers?: string[];
  custom?: boolean;
}

// The Claude and Codex lanes ride a subscription through a CLI, so there is no
// endpoint to ask what models exist and their lists are written out by hand in
// the backend. These two config keys append to them, so a model that shipped
// this morning can be selected from here rather than waiting on a code change.
const EXTRA_KEY = { claude: 'models.extra_claude', codex: 'models.extra_codex' } as const;
type ModelLane = keyof typeof EXTRA_KEY;

function laneFor(provider: string): ModelLane | null {
  if (provider === 'claude-cli' || provider === 'anthropic') return 'claude';
  if (provider === 'codex' || provider === 'codex-cli') return 'codex';
  return null;
}

// Match Resonant's ModelSelector.svelte exactly — only the short labels
// are mapped, everything else falls back to the raw provider key.
const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  'claude-cli': 'CLI',
  codex: 'Codex',
  'codex-cli': 'GPT CLI',
  ollama: 'Ollama',
  huggingface: 'HF',
};

const LS_FAVS = 'aerie-fav-models';

function loadFavs(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_FAVS) || '[]'));
  } catch {
    return new Set();
  }
}


export function ModelPill({ themeConfig, themeMode }: ModelPillProps) {
  const colors = themeConfig[themeMode];
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [currentModel, setCurrentModel] = useState('');
  const [lanes, setLanes] = useState<LaneModelState[]>([]);
  const [routing, setRouting] = useState('sdk');
  const [favs, setFavs] = useState<Set<string>>(() => loadFavs());
  const [activeProvider, setActiveProvider] = useState('');
  const [claudeThinking, setClaudeThinking] = useState('adaptive');
  const [claudeEffort, setClaudeEffort] = useState('adaptive');
  const [codexEffort, setCodexEffort] = useState('adaptive');
  const [codexSpeed, setCodexSpeed] = useState('standard');
  const [settingPanel, setSettingPanel] = useState<'thinking' | 'speed' | null>(null);
  const [extras, setExtras] = useState<Record<ModelLane, string>>({ claude: '', codex: '' });
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState('');
  const [adding, setAdding] = useState(false);
  /** Last `agent.model` this component saw, so the poll can tell a change
   *  from a re-read. Empty on mount: a first read is not a switch. */
  const lastSeenModel = useRef('');

  /** Everything this pill displays comes from config, and config can move
   *  without this component hearing a word about it — `/model` in the composer
   *  writes the same setting the sheet does. Read on mount, on every open, and
   *  whenever the app comes back to the foreground; a mount-only read leaves
   *  the pill showing whatever happened to be true when the page loaded. */
  async function loadSettings(): Promise<Record<string, string> | null> {
    try {
      const res = await apiFetch('/api/settings');
      if (!res.ok) return null;
      const data = await res.json();
      const cfg = data.config || {};
      setExtras({ claude: cfg[EXTRA_KEY.claude] || '', codex: cfg[EXTRA_KEY.codex] || '' });
      // This poll is the only thing in the app that ever notices the model
      // moved, whoever moved it — so it is also the only honest place to drop
      // the readouts that belonged to the old one. The direct call in
      // selectModel makes it instant on the path the user actually uses; this
      // catches `/model` in the composer and the settings route as well.
      const nextModel = cfg['agent.model'] || '';
      if (isModelSwitch(lastSeenModel.current, nextModel)) {
        clearProviderScopedState();
      }
      lastSeenModel.current = nextModel;
      setCurrentModel(nextModel);
      setRouting(cfg['agent.routing'] || 'sdk');
      setClaudeThinking(cfg['agent.claude_thinking'] || cfg['agent.thinking'] || 'adaptive');
      setClaudeEffort(cfg['agent.claude_effort'] || cfg['agent.effort'] || 'adaptive');
      setCodexEffort(cfg['agent.codex_effort'] || cfg['agent.effort'] || 'adaptive');
      setCodexSpeed(cfg['agent.codex_speed'] || 'standard');
      return cfg;
    } catch {
      return null;
    }
  }

  // The interval below must not fire while the sheet is open: tapping a
  // setting there writes optimistically and PUTs, and a read landing between
  // the two would put the user's own change back. State would be stale in the
  // closure, so the ref is the only honest read of it.
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    void loadSettings();
    // Closing the app and coming back already fixed a stale pill, because that
    // was a full reload. These two make the same gesture work without one.
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadSettings();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    // And a slow read while visible, because those two listeners only fire for
    // someone who leaves and comes back. This setting has several writers —
    // this sheet, `/model` in the composer, the settings route — and not one of
    // them can tell this component it moved. On a desktop left open for hours
    // nothing ever regains focus, so without this the pill only catches up when
    // the sheet is opened, which is exactly what a user reported.
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible' && !openRef.current) void loadSettings();
    }, 15_000);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      clearInterval(tick);
    };
  }, []);

  async function loadModels(): Promise<ModelInfo[]> {
    const res = await apiFetch('/api/models');
    if (!res.ok) throw new Error('models request failed');
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('models response was not a list');
    setModels(list as ModelInfo[]);
    return list as ModelInfo[];
  }

  /** Which warm lanes are up, and anything the CLI refused to launch on.
   *  Best-effort: a backend without this route answers the SPA's index.html
   *  with a 200, so the shape is the check, and a miss just means no notice. */
  async function loadLaneState(): Promise<void> {
    try {
      const res = await apiFetch('/api/models/lanes');
      const body = await res.json();
      setLanes(Array.isArray(body?.lanes) ? (body.lanes as LaneModelState[]) : []);
    } catch {
      setLanes([]);
    }
  }

  async function openPicker() {
    setOpen(true);
    // Re-read every open rather than once: a refusal can happen at any time
    // while the sheet is closed, and a stale empty answer would hide it.
    void loadLaneState();
    // Awaited, unlike the lane read: the provider tab and the refused notice
    // are both decided from config, so opening on mount-state would pick the
    // tab from routing as it was at page load and key the notice on a model
    // the user may have moved since. Half live and half snapshot is how the notice
    // came to silently not draw.
    const cfg = await loadSettings();
    const liveRouting = cfg?.['agent.routing'] || routing;
    // Always set activeProvider to match current routing when opening
    const routingProvider = liveRouting === 'cli' ? 'claude-cli' : liveRouting === 'sdk' ? 'anthropic' : liveRouting === 'codex-cli' ? 'codex-cli' : '';
    if (routingProvider) setActiveProvider(routingProvider);
    if (loadState === 'ready' || loadState === 'loading') return;
    setLoadState('loading');
    try {
      const list = await loadModels();
      // If routing didn't set a provider, fall back to first available
      if (!routingProvider) {
        setActiveProvider(list[0]?.provider || '');
      }
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }

  // Adding and removing both rewrite the whole list, because that is the only
  // shape the config store holds — one string per lane.
  async function saveExtras(lane: ModelLane, value: string) {
    setExtras(prev => ({ ...prev, [lane]: value }));
    await saveSetting(EXTRA_KEY[lane], value);
    try {
      await loadModels();
    } catch {
      /* the write landed; the list refreshes on the next open */
    }
  }

  async function addModel(lane: ModelLane) {
    const id = draft.trim();
    if (!id) return;
    if (/\s/.test(id)) {
      setDraftError('One model id, no spaces.');
      return;
    }
    if (models.some(m => m.id === id && laneFor(m.provider) === lane)) {
      setDraftError('Already in this list.');
      return;
    }
    setDraftError('');
    setDraft('');
    setAdding(false);
    const existing = extras[lane].trim();
    await saveExtras(lane, existing ? `${existing}\n${id}` : id);
  }

  async function removeModel(lane: ModelLane, id: string) {
    const kept = extras[lane]
      .split(/[\n,]/)
      .map(entry => entry.trim())
      .filter(entry => entry && entry.split('|')[0].trim() !== id);
    await saveExtras(lane, kept.join('\n'));
  }

  async function selectModel(m: ModelInfo) {
    setOpen(false);
    // No early return on same-model picks: the same model can be re-picked
    // on a different lane (SDK ↔ CLI), which still needs the routing write.
    setCurrentModel(m.id);
    const isClaudeCliLane = m.provider === 'claude-cli';
    const isCodexCliLane = m.provider === 'codex-cli';
    const isCodexProvider = isCodexCliLane || m.provider === 'codex';
    const isClaude = m.id.toLowerCase().startsWith('claude-');
    const updates: { key: string; value: string }[] = [
      { key: 'agent.model', value: m.id },
      // The CLI lanes keep provider in the known set
      { key: 'agent.provider', value: isClaudeCliLane ? 'anthropic' : isCodexProvider ? 'codex' : m.provider },
    ];
    // Companion-chat Codex selections always use the warm CLI lane. The
    // stateless Codex runtime remains available to dedicated backend services,
    // but it does not carry the interactive authored-thought contract.
    if (isClaudeCliLane && routing !== 'cli') updates.push({ key: 'agent.routing', value: 'cli' });
    else if (isCodexProvider && routing !== 'codex-cli') updates.push({ key: 'agent.routing', value: 'codex-cli' });
    else if (!isClaudeCliLane && !isCodexCliLane && m.provider === 'anthropic' && routing !== 'sdk') updates.push({ key: 'agent.routing', value: 'sdk' });
    else if (!isClaude && !isCodexProvider && (routing === 'sdk' || routing === 'cli')) updates.push({ key: 'agent.routing', value: 'auto' });
    console.log('[ModelPill] selectModel updates:', updates);
    // The banner and the context readout belong to the model being left
    // behind. Drop them here rather than waiting for something to overwrite
    // them — a rate limit on the old provider is not a fact about the new one.
    clearProviderScopedState();
    for (const u of updates) {
      try {
        console.log(`[ModelPill] PUT /api/settings ${u.key}=${u.value}`);
        await apiFetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(u),
        });
        if (u.key === 'agent.routing') setRouting(u.value);
      } catch (err) {
        console.error('[ModelPill] PUT error:', err);
      }
    }
  }

  async function saveSetting(key: string, value: string) {
    await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
  }

  function toggleFav(key: string) {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem(LS_FAVS, JSON.stringify([...next]));
      return next;
    });
  }

  const providers = Array.from(new Set(models.map((m) => m.provider)));
  const inProvider = models.filter((m) => m.provider === activeProvider);
  const modelKey = (m: ModelInfo) => `${m.provider}:${m.id}`;
  const sorted = [...inProvider].sort((a, b) => {
    const fa = favs.has(modelKey(a)) ? 0 : 1;
    const fb = favs.has(modelKey(b)) ? 0 : 1;
    return fa - fb;
  });
  const currentName = models.find((m) => m.id === currentModel)?.name || modelLabel(currentModel) || 'Model';
  // The lane, if any, that tried the model the user currently has set and was
  // refused. Keyed on the refusal rather than on running !== currentModel,
  // which is true for every tap in this sheet until the next turn.
  const refusedHere = lanes.find((l) => l.refused.includes(currentModel)) || null;
  const activeLane = laneFor(activeProvider);
  const isClaudeLane = activeProvider === 'anthropic' || activeProvider === 'claude-cli';
  const isCodexLane = activeProvider === 'codex' || activeProvider === 'codex-cli';
  const selectedForLane = models.find((m) => m.provider === activeProvider && m.id === currentModel)
    || models.find((m) => m.provider === activeProvider);
  const codexLevels = selectedForLane?.reasoning_levels?.length
    ? selectedForLane.reasoning_levels
    : ['low', 'medium', 'high', 'xhigh', 'max'];
  const supportsFast = selectedForLane?.speed_tiers?.includes('fast') ?? false;
  const effortLabel = (value: string) => ({
    adaptive: 'Adaptive', low: 'Light', medium: 'Medium', high: 'High',
    xhigh: 'Extra High', max: 'Max', ultra: 'Ultra', enabled: 'Always', disabled: 'Off',
  }[value] || value);

  function choiceButton(label: string, active: boolean, onClick: () => void, hint?: string) {
    return (
      <button
        onClick={onClick}
        className={cn('w-full flex items-center justify-between rounded-xl px-3 py-2 text-left', colors.textMain)}
        style={active ? { background: themeMode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' } : undefined}
      >
        <span>
          <span className="block text-sm font-medium">{label}</span>
          {hint && <span className={cn('block text-[10px]', colors.textMuted)}>{hint}</span>}
        </span>
        {active && <span style={{ color: colors.accent }}>✓</span>}
      </button>
    );
  }

  return (
    <>
      <button
        onClick={openPicker}
        className={cn('flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-medium', colors.panelBorder, colors.textMuted)}
      >
        {currentName}
        <ChevronDown size={10} />
      </button>

      {createPortal(
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="model-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setOpen(false)}
            />
            <motion.div
              key="model-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320 }}
              className={cn('fixed inset-x-0 bottom-0 z-50 max-h-[75%] flex flex-col rounded-t-3xl border-t', colors.panelBg, colors.panelBorder)}
            >
              <div className="shrink-0 flex items-center justify-between px-4 pt-3 pb-2">
                <span className={cn('text-sm font-semibold', colors.textMain)}>Model</span>
                <button onClick={() => setOpen(false)} className={cn('rounded-full p-1.5', colors.textMuted)}>
                  <X size={16} />
                </button>
              </div>

              {providers.length > 0 && (
                <div className="shrink-0 flex gap-1.5 px-4 pb-2 overflow-x-auto scrollbar-hide">
                  {providers.map((p) => {
                    const active = activeProvider === p;
                    // Identical className footprint for active + inactive so
                    // the only difference between states is the color of
                    // the bg/border/text — keeps Tailwind specificity stable
                    // and the rendered widths consistent. min-w-[3.5rem]
                    // levels short labels (SDK, HF) with longer ones (Ollama).
                    return (
                      <button
                        key={p}
                        onClick={() => setActiveProvider(p)}
                        className={cn(
                          'shrink-0 min-w-[3.5rem] rounded-lg px-3 py-1 text-[11px] font-medium border whitespace-nowrap text-center',
                          colors.panelBorder,
                          colors.textMain,
                        )}
                        style={
                          active
                            ? { background: colors.accent, color: 'var(--aerie-on-accent)', borderColor: colors.accent }
                            : undefined
                        }
                      >
                        {PROVIDER_LABEL[p] || p}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Only ever shown for a model a lane actually tried and was
                  refused on. Never for a model merely selected and not yet
                  launched — tapping writes the setting immediately and defers
                  the recycle, so "selected is not running" is the normal state
                  of browsing this very sheet. */}
              {refusedHere && (
                <div
                  className={cn('shrink-0 mx-4 mb-2 rounded-2xl border px-3 py-2', colors.panelBorder)}
                  style={{ borderColor: colors.accent }}
                  role="status"
                >
                  <div className={cn('text-sm font-semibold', colors.textMain)}>
                    This model would not start
                  </div>
                  <div className={cn('text-[11px] mt-0.5', colors.textMuted)}>
                    The Claude CLI refused <span className="font-mono">{currentModel}</span>, so the{' '}
                    {refusedHere.key} lane is running <span className="font-mono">{refusedHere.running}</span>.
                    Your setting is unchanged — pick a model here to move it.
                  </div>
                </div>
              )}

              {(isClaudeLane || isCodexLane) && (
                <div className={cn('shrink-0 mx-4 mb-2 rounded-2xl border overflow-hidden', colors.panelBorder)}>
                  <button
                    onClick={() => setSettingPanel(settingPanel === 'thinking' ? null : 'thinking')}
                    className={cn('w-full flex items-center gap-3 px-3 py-2.5 text-left', colors.textMain)}
                  >
                    <span className="flex-1">
                      <span className="block text-sm font-semibold">Thinking</span>
                      <span className={cn('block text-[11px]', colors.textMuted)}>
                        {isClaudeLane
                          ? `${effortLabel(claudeEffort)} · ${effortLabel(claudeThinking)}`
                          : effortLabel(codexEffort === 'adaptive' ? (selectedForLane?.default_reasoning_level || 'adaptive') : codexEffort)}
                      </span>
                    </span>
                    <ChevronRight size={16} className={cn(colors.textMuted, settingPanel === 'thinking' && 'rotate-90')} />
                  </button>
                  {settingPanel === 'thinking' && (
                    <div className={cn('border-t p-2', colors.panelBorder)}>
                      {isClaudeLane && (
                        <>
                          <div className={cn('px-2 pb-1 text-[10px] font-bold uppercase tracking-wider', colors.textMuted)}>Mode</div>
                          <div className="grid grid-cols-3 gap-1 mb-2">
                            {['disabled', 'adaptive', 'enabled'].map(mode => (
                              <button
                                key={mode}
                                onClick={() => {
                                  setClaudeThinking(mode);
                                  void saveSetting('agent.claude_thinking', mode);
                                }}
                                className={cn('rounded-lg border px-1 py-1.5 text-[11px]', colors.panelBorder, colors.textMain)}
                                style={claudeThinking === mode ? { background: colors.accent, color: 'var(--aerie-on-accent)' } : undefined}
                              >{mode === 'disabled' ? 'Off' : mode === 'enabled' ? 'Always' : 'Adaptive'}</button>
                            ))}
                          </div>
                          <div className={cn('px-2 pb-1 text-[10px] font-bold uppercase tracking-wider', colors.textMuted)}>Effort</div>
                          {['adaptive', 'low', 'medium', 'high', 'xhigh', 'max'].map(level =>
                            choiceButton(effortLabel(level), claudeEffort === level, () => {
                              setClaudeEffort(level);
                              void saveSetting('agent.claude_effort', level);
                            }))}
                        </>
                      )}
                      {isCodexLane && codexLevels.map(level =>
                        choiceButton(effortLabel(level), codexEffort === level || (codexEffort === 'adaptive' && selectedForLane?.default_reasoning_level === level), () => {
                          setCodexEffort(level);
                          void saveSetting('agent.codex_effort', level);
                        }, level === selectedForLane?.default_reasoning_level ? 'Model default' : undefined))}
                    </div>
                  )}
                  {isCodexLane && supportsFast && (
                    <>
                      <div className={cn('border-t', colors.panelBorder)} />
                      <button
                        onClick={() => setSettingPanel(settingPanel === 'speed' ? null : 'speed')}
                        className={cn('w-full flex items-center gap-3 px-3 py-2.5 text-left', colors.textMain)}
                      >
                        <span className="flex-1">
                          <span className="block text-sm font-semibold">Speed</span>
                          <span className={cn('block text-[11px]', colors.textMuted)}>{codexSpeed === 'fast' ? 'Fast' : 'Standard'}</span>
                        </span>
                        <ChevronRight size={16} className={cn(colors.textMuted, settingPanel === 'speed' && 'rotate-90')} />
                      </button>
                      {settingPanel === 'speed' && (
                        <div className={cn('border-t p-2', colors.panelBorder)}>
                          {choiceButton('Standard', codexSpeed === 'standard', () => {
                            setCodexSpeed('standard');
                            void saveSetting('agent.codex_speed', 'standard');
                          }, 'Default usage')}
                          {choiceButton('Fast', codexSpeed === 'fast', () => {
                            setCodexSpeed('fast');
                            void saveSetting('agent.codex_speed', 'fast');
                          }, 'Increased usage')}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-y-auto scrollbar-hide px-2 pb-4">
                {loadState === 'loading' && (
                  <div className={cn('flex items-center justify-center gap-2 py-6 text-xs', colors.textMuted)}>
                    <Loader2 size={14} className="animate-spin" /> Loading models…
                  </div>
                )}
                {loadState === 'error' && (
                  <div className="py-6 text-center text-xs" style={{ color: colors.accent, opacity: 0.8 }}>
                    Could not load models.
                  </div>
                )}
                {loadState === 'ready' && sorted.length === 0 && (
                  <div className={cn('py-6 text-center text-xs', colors.textMuted)}>No models for this provider.</div>
                )}
                {sorted.map((m) => {
                  const key = modelKey(m);
                  const isFav = favs.has(key);
                  const isActive = m.id === currentModel;
                  const ownLane = laneFor(m.provider);
                  return (
                    <div key={key} className="flex items-center gap-1 px-2">
                      <button onClick={() => toggleFav(key)} className="p-1.5 shrink-0">
                        <Star
                          size={13}
                          style={{ color: isFav ? colors.accent : 'rgba(127,127,127,0.5)' }}
                          fill={isFav ? colors.accent : 'none'}
                        />
                      </button>
                      <button
                        onClick={() => selectModel(m)}
                        className="flex flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left min-w-0"
                        style={isActive ? { background: themeMode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)' } : undefined}
                      >
                        <span
                          className={cn('flex-1 truncate text-sm', colors.textMain)}
                          style={{ color: isActive ? colors.accent : undefined }}
                        >
                          {m.name}
                        </span>
                        {m.supports_tools && <Wrench size={11} className={colors.textMuted} />}
                      </button>
                      {m.custom && ownLane && (
                        <button
                          onClick={() => void removeModel(ownLane, m.id)}
                          className="p-1.5 shrink-0"
                          aria-label={`Remove ${m.name}`}
                        >
                          <X size={12} className={colors.textMuted} />
                        </button>
                      )}
                    </div>
                  );
                })}

                {loadState === 'ready' && activeLane && (adding ? (
                  <div className="px-4 pt-1 pb-2">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => { setDraft(e.target.value); setDraftError(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') void addModel(activeLane); }}
                      placeholder={activeLane === 'claude' ? 'claude-opus-6' : 'gpt-5.7'}
                      className={cn('w-full rounded-lg border px-2.5 py-2 text-sm bg-transparent', colors.panelBorder, colors.textMain)}
                    />
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        onClick={() => void addModel(activeLane)}
                        className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-medium"
                        style={{ background: colors.accent, color: 'var(--aerie-on-accent)' }}
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setAdding(false); setDraft(''); setDraftError(''); }}
                        className={cn('shrink-0 rounded-lg px-3 py-1.5 text-[11px]', colors.textMuted)}
                      >
                        Cancel
                      </button>
                      <span
                        className={cn('flex-1 text-[10px] leading-tight', colors.textMuted)}
                        style={draftError ? { color: colors.accent } : undefined}
                      >
                        {draftError || 'Spelled the way the provider spells it. Nothing here checks it.'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAdding(true)}
                    className={cn('flex w-full items-center gap-2 rounded-lg px-4 py-2.5 text-left text-sm', colors.textMuted)}
                  >
                    <Plus size={13} /> Add a model
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>,
      document.body,
      )}
    </>
  );
}
