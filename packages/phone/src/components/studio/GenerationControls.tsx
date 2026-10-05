// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Loader2, Plus, X, User, Palette, Wand2, Compass } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Backend, GenerationControlsProps } from './types';
import { ACCENT_TEXT_COLOR_BY_THEME, CODEX_MODELS, ANTIGRAVITY_MODELS, OPENART_MODELS, PROMPT_STYLES, PROMPT_DIRECTIVES, SIZE_PRESETS, MIN_DIMENSION, MAX_DIMENSION, clampDimension } from './constants';

const BACKEND_BUTTONS: ReadonlyArray<{ key: Backend; label: string }> = [
  { key: 'codex', label: 'Codex' },
  { key: 'antigravity', label: 'Gemini' },
  { key: 'openart', label: 'OpenArt' },
];

// A size field holds what you typed until you leave it. Clamping on every
// keystroke made the box impossible to type into: the 9 on the way to 906
// became the 256 minimum, the next digit landed on that, and an emptied box
// refilled itself instantly — so pasting a finished number was the only way in.
// The draft owns the text while it has focus; the clamp waits for blur.
function DimensionInput({ value, onCommit, placeholder, className }: {
  value: number;
  onCommit: (next: number) => void;
  placeholder: string;
  className: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const typed = parseInt(draft ?? '', 10);
    onCommit(Number.isFinite(typed) ? clampDimension(typed) : value);
    setDraft(null);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      value={draft ?? String(value)}
      onChange={e => {
        setDraft(e.target.value);
        // Keep the parent current without clamping, so tapping Generate can
        // never read a stale number if blur has not landed yet.
        const typed = parseInt(e.target.value, 10);
        if (Number.isFinite(typed)) onCommit(typed);
      }}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className={className}
      placeholder={placeholder}
      min={MIN_DIMENSION}
      max={MAX_DIMENSION}
    />
  );
}

export function GenerationControls({
  colors, themeMode,
  backend, setBackend,
  backendStatus,
  codexModel, setCodexModel,
  agyModel, setAgyModel,
  openartModel, setOpenartModel,
  size, setSize,
  customWidth, setCustomWidth,
  customHeight, setCustomHeight,
  drawers, selectedSubjects, toggleSubject, showSubjects, setShowSubjects,
  prompt, setPrompt,
  selectedStyle, setSelectedStyle,
  selectedDirective, setSelectedDirective,
  showStylePicker, setShowStylePicker,
  showDirectivePicker, setShowDirectivePicker,
  generating, handleGenerate,
  enhancing, handleEnhance,
  error,
}: GenerationControlsProps) {
  const selectedStatus = backendStatus.find((s) => s.key === backend);
  return (
    <div className={cn("p-4 rounded-2xl border backdrop-blur-md space-y-4", colors.panelBg, colors.panelBorder)}>
      {/* Backend Picker */}
      <div>
        <label className={cn("block text-xs font-medium mb-1.5 uppercase tracking-wide", colors.textMuted)}>Backend</label>
        <div className="flex gap-2">
          {BACKEND_BUTTONS.map(({ key, label }) => {
            const status = backendStatus.find((s) => s.key === key);
            const unavailable = status ? !status.ready : false;
            const selected = backend === key;
            return (
              <button
                key={key}
                onClick={() => setBackend(key)}
                className={cn(
                  "flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
                  selected ? "border-current" : cn(colors.panelBorder, colors.textMuted),
                  unavailable && !selected && "opacity-50",
                )}
                style={selected ? { borderColor: colors.accent, color: colors.accent } : undefined}
              >
                {label}
                {unavailable && (
                  <span className="block text-[10px] font-normal leading-tight opacity-80">not set up</span>
                )}
              </button>
            );
          })}
        </div>
        {selectedStatus && !selectedStatus.ready && (
          <div className={cn("mt-2 rounded-lg border px-2.5 py-2 text-[11px] leading-snug", colors.panelBg, colors.panelBorder, colors.textMuted)}>
            <div className={colors.textMain}>{selectedStatus.reason}</div>
            {selectedStatus.fix && (
              <div className="mt-1 font-mono text-[10px] break-all" style={{ color: colors.accent }}>
                {selectedStatus.fix}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Model Picker (Codex/GPT) */}
      {backend === 'codex' && (
        <div>
          <label className={cn("block text-xs font-medium mb-1.5 uppercase tracking-wide", colors.textMuted)}>GPT Model</label>
          <select
            value={codexModel}
            onChange={(e) => setCodexModel(e.target.value)}
            className={cn("w-full px-3 py-2 rounded-lg border text-sm", colors.panelBg, colors.panelBorder, colors.textMain, "focus:outline-none focus:ring-2")}
            style={{ '--tw-ring-color': colors.accent } as CSSProperties}
          >
            {CODEX_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.name} — {m.desc}</option>
            ))}
          </select>
        </div>
      )}

      {/* Model Picker (Antigravity/Gemini) */}
      {backend === 'antigravity' && (
        <div>
          <label className={cn("block text-xs font-medium mb-1.5 uppercase tracking-wide", colors.textMuted)}>Gemini Model</label>
          <select
            value={agyModel}
            onChange={(e) => setAgyModel(e.target.value)}
            className={cn("w-full px-3 py-2 rounded-lg border text-sm", colors.panelBg, colors.panelBorder, colors.textMain, "focus:outline-none focus:ring-2")}
            style={{ '--tw-ring-color': colors.accent } as CSSProperties}
          >
            {ANTIGRAVITY_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.name} — {m.desc}</option>
            ))}
          </select>
        </div>
      )}

      {/* Model Picker (OpenArt — images and video) */}
      {backend === 'openart' && (
        <div>
          <label className={cn("block text-xs font-medium mb-1.5 uppercase tracking-wide", colors.textMuted)}>OpenArt Model</label>
          <select
            value={openartModel}
            onChange={(e) => setOpenartModel(e.target.value)}
            className={cn("w-full px-3 py-2 rounded-lg border text-sm", colors.panelBg, colors.panelBorder, colors.textMain, "focus:outline-none focus:ring-2")}
            style={{ '--tw-ring-color': colors.accent } as CSSProperties}
          >
            <optgroup label="Images">
              {OPENART_MODELS.filter(m => m.media === 'image').map(m => (
                <option key={m.key} value={m.key}>{m.name} — {m.desc}</option>
              ))}
            </optgroup>
            <optgroup label="Video">
              {OPENART_MODELS.filter(m => m.media === 'video').map(m => (
                <option key={m.key} value={m.key}>{m.name} — {m.desc}</option>
              ))}
            </optgroup>
          </select>
        </div>
      )}

      {/* Size */}
      <div>
        <label className={cn("block text-xs font-medium mb-1.5 uppercase tracking-wide", colors.textMuted)}>Size</label>
        <div className="flex gap-1.5 flex-wrap">
          {SIZE_PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => setSize(p.value)}
              className={cn("px-2.5 py-1 rounded-full text-xs font-medium border transition-colors", size === p.value ? "border-current" : cn(colors.panelBorder, colors.textMuted))}
              style={size === p.value ? { borderColor: colors.accent, color: colors.accent } : undefined}
              title={p.dims}
            >
              {p.label}
            </button>
          ))}
        </div>
        {size === 'custom' && (
          <div className="flex gap-2 mt-2 items-center">
            <DimensionInput
              value={customWidth}
              onCommit={setCustomWidth}
              placeholder="Width"
              className={cn("w-20 px-2 py-1 rounded text-xs border", colors.panelBg, colors.panelBorder, colors.textMain)}
            />
            <span className={colors.textMuted}>×</span>
            <DimensionInput
              value={customHeight}
              onCommit={setCustomHeight}
              placeholder="Height"
              className={cn("w-20 px-2 py-1 rounded text-xs border", colors.panelBg, colors.panelBorder, colors.textMain)}
            />
            <span className={cn("text-xs", colors.textMuted)}>px</span>
          </div>
        )}
      </div>

      {/* Reference Subjects (Codex/Antigravity/OpenArt) */}
      {(backend === 'codex' || backend === 'antigravity' || backend === 'openart') && drawers.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className={cn("text-xs font-medium uppercase tracking-wide", colors.textMuted)}>Reference Subjects</label>
            <button onClick={() => setShowSubjects(!showSubjects)} className={cn("p-1 rounded", colors.textMuted)}>
              <User className="w-3.5 h-3.5" />
            </button>
          </div>
          <AnimatePresence>
            {showSubjects && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="flex gap-1.5 flex-wrap py-2">
                  {drawers.map(d => (
                    <button
                      key={d.slug}
                      onClick={() => toggleSubject(d.slug)}
                      className={cn("px-2 py-1 rounded-full text-xs border transition-colors flex items-center gap-1", selectedSubjects.includes(d.slug) ? "border-current" : cn(colors.panelBorder, colors.textMuted))}
                      style={selectedSubjects.includes(d.slug) ? { borderColor: colors.accent, color: colors.accent } : undefined}
                    >
                      {d.emoji && <span>{d.emoji}</span>}
                      {d.label}
                      {d.refs.length > 0 && <span className="opacity-50">({d.refs.length})</span>}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {selectedSubjects.length > 0 && !showSubjects && (
            <div className="flex gap-1 flex-wrap">
              {selectedSubjects.map(slug => {
                const d = drawers.find(x => x.slug === slug);
                return d ? (
                  <button
                    key={slug}
                    onClick={() => toggleSubject(slug)}
                    className="px-2 py-0.5 rounded-full text-xs flex items-center gap-1"
                    style={{ backgroundColor: colors.accent + '20', color: colors.accent }}
                    title={`Remove ${d.label} reference`}
                  >
                    {d.label}
                    <X className="w-3 h-3" />
                  </button>
                ) : null;
              })}
            </div>
          )}
        </div>
      )}

      {/* Prompt with Style */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className={cn("text-xs font-medium uppercase tracking-wide", colors.textMuted)}>Prompt</label>
          <div className="flex items-center gap-2">
            <button
              onClick={handleEnhance}
              disabled={!prompt.trim() || enhancing}
              className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50", colors.panelBorder, colors.textMuted)}
              title="Enhance prompt with AI"
            >
              {enhancing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            </button>
            {/* A directive sits beside the style rather than inside it: one says
                how to treat the input, the other says what the output looks
                like, and both can be on at once. */}
            <button
              onClick={() => setShowDirectivePicker(!showDirectivePicker)}
              className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors", selectedDirective ? "border-current" : cn(colors.panelBorder, colors.textMuted))}
              style={selectedDirective ? { borderColor: colors.accent, color: colors.accent } : undefined}
            >
              <Compass className="w-3 h-3" />
              {selectedDirective || 'Directive'}
            </button>
            <button
              onClick={() => setShowStylePicker(!showStylePicker)}
              className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors", selectedStyle ? "border-current" : cn(colors.panelBorder, colors.textMuted))}
              style={selectedStyle ? { borderColor: colors.accent, color: colors.accent } : undefined}
            >
              <Palette className="w-3 h-3" />
              {selectedStyle || 'Style'}
            </button>
          </div>
        </div>
        <AnimatePresence>
          {showDirectivePicker && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-2">
              <div className="flex gap-1.5 flex-wrap py-2">
                {PROMPT_DIRECTIVES.map(d => (
                  <button
                    key={d.name}
                    onClick={() => { setSelectedDirective(d.name === 'None' ? '' : d.name); setShowDirectivePicker(false); }}
                    className={cn("px-2 py-0.5 rounded-full text-xs border transition-colors", (selectedDirective === d.name || (d.name === 'None' && !selectedDirective)) ? "border-current" : cn(colors.panelBorder, colors.textMuted))}
                    style={(selectedDirective === d.name || (d.name === 'None' && !selectedDirective)) ? { borderColor: colors.accent, color: colors.accent } : undefined}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
          {showStylePicker && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-2">
              <div className="flex gap-1.5 flex-wrap py-2">
                {PROMPT_STYLES.map(s => (
                  <button
                    key={s.name}
                    onClick={() => { setSelectedStyle(s.name === 'None' ? '' : s.name); setShowStylePicker(false); }}
                    className={cn("px-2 py-0.5 rounded-full text-xs border transition-colors", (selectedStyle === s.name || (s.name === 'None' && !selectedStyle)) ? "border-current" : cn(colors.panelBorder, colors.textMuted))}
                    style={(selectedStyle === s.name || (s.name === 'None' && !selectedStyle)) ? { borderColor: colors.accent, color: colors.accent } : undefined}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <textarea
          id="aerie-studio-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what you want to create..."
          rows={3}
          className={cn("w-full px-3 py-2 rounded-lg border text-sm resize-none", colors.panelBg, colors.panelBorder, colors.textMain, "placeholder:opacity-50 focus:outline-none focus:ring-2")}
          style={{ '--tw-ring-color': colors.accent } as CSSProperties}
        />
      </div>

      {/* Generate */}
      <button
        onClick={handleGenerate}
        disabled={!prompt.trim()}
        className={cn("w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2")}
        style={{ backgroundColor: colors.accent, color: ACCENT_TEXT_COLOR_BY_THEME[themeMode] }}
      >
        {generating ? <><Loader2 className="w-4 h-4 animate-spin" />Queue another</> : <><Sparkles className="w-4 h-4" />Generate</>}
      </button>

      {error && <div className="text-sm text-center py-2 px-3 rounded-lg" style={{ color: '#ff6b6b' }}>{error}</div>}
    </div>
  );
}
