// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React from "react";
import { X, Palette, Upload, Check, Plus, Minus, Settings as SettingsIcon, UserRound, Shapes, Home, ChevronLeft } from "lucide-react";
import { AppShell } from "./AppShell";
import Cropper from "react-easy-crop";
import { cn } from "../lib/utils";
import { LockPreview } from "./LockClock";
import { lockClockAtOf, lockFaceOf, lockHiddenOf, lockPositionOf, lockSizeOf } from "../lib/lock-clock";
import { useSettingsState, type SettingsDashboardProps } from './settings/use-settings-state';
import { ThemePane } from './settings/ThemePane';
import { LockPane } from './settings/LockPane';
import { YouPane } from './settings/YouPane';
import { LookPane } from './settings/LookPane';
import { HomePane } from './settings/HomePane';
import { DataPane } from './settings/DataPane';

export const SettingsDashboard: React.FC<SettingsDashboardProps> = (props) => {
  const s = useSettingsState(props);
  const { activeTheme, colors, resolvedAccent, activeTab, setActiveTab, pane, setPane, cropImageSrc, setCropImageSrc, cropTarget, isSaving, crop, setCrop, zoom, setZoom, onCropComplete, handleSaveCrop, handleUseOriginal, theme, onClose } = s;
  return (
    <AppShell
      title="Settings"
      icon={SettingsIcon}
      onClose={onClose}
      themeConfig={activeTheme}
      themeMode={theme.mode}
    >
      <div>
        {cropImageSrc && (
          <div
            className="fixed left-0 right-0 bottom-0 z-[60] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4"
            style={{ top: 'calc(var(--sat, 0px) + 3.25rem)' }}
          >
            <div
              className={cn(
                "w-full max-w-sm flex flex-col gap-4 overflow-hidden border shadow-2xl",
                activeTheme.radius,
                colors.panelBg,
                colors.panelBorder,
              )}
            >
              <div className={cn("p-4 border-b flex items-center justify-between", colors.panelBorder)}>
                <h3 className={cn("text-[10px] font-bold uppercase tracking-widest", colors.textMuted)}>
                  Position Image
                </h3>
                <button
                  onClick={() => setCropImageSrc(null)}
                  className={cn("p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10", colors.textMain)}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="relative flex items-center justify-center bg-black/40 cursor-move h-96">
                <Cropper
                  image={cropImageSrc}
                  crop={crop}
                  zoom={zoom}
                  // minZoom=1 means the image always at least fills the crop
                  // area — preventing the empty white bars that appeared when
                  // you could zoom out smaller than the frame. Paired with
                  // restrictPosition=true so the image edge can't be dragged
                  // past the crop edge either.
                  minZoom={1}
                  maxZoom={10}
                  aspect={cropTarget === "avatar" ? 1 : 9 / 16}
                  cropShape={cropTarget === "avatar" ? "round" : "rect"}
                  onCropChange={setCrop}
                  onCropComplete={onCropComplete}
                  onZoomChange={setZoom}
                  showGrid={true}
                  restrictPosition={true}
                />
                <div className="absolute bottom-2 left-0 right-0 flex justify-center pointer-events-none">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-white/80 bg-black/50 px-2 py-1 rounded-[var(--shape-control)]">
                    Drag to Position • Pinch to Zoom
                  </span>
                </div>
              </div>

              <div className="p-5 flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center px-1">
                    <span className={cn("text-[10px] font-bold uppercase tracking-wider", colors.textMuted)}>
                      Scale & Placement
                    </span>
                    <span className={cn("text-[10px] font-mono", colors.textMuted)}>
                      {Math.round(zoom * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-4 px-1">
                    <Minus size={14} className={colors.textMuted} />
                    <input
                      type="range"
                      value={zoom}
                      min={0.1}
                      max={10}
                      step={0.1}
                      aria-labelledby="Zoom"
                      onChange={(e) => setZoom(Number(e.target.value))}
                      className="flex-1 h-1 rounded-lg appearance-none cursor-pointer bg-black/10 dark:bg-white/10"
                      style={{ accentColor: colors.accent }}
                    />
                    <Plus size={14} className={colors.textMuted} />
                  </div>
                </div>

                <div className="flex justify-end gap-2 items-center">
                  <button
                    onClick={() => setCropImageSrc(null)}
                    className={cn("px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors opacity-60 hover:opacity-100", colors.textMuted)}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUseOriginal}
                    disabled={isSaving}
                    className={cn(
                      "px-4 py-2 text-[10px] font-bold uppercase tracking-widest border rounded-[var(--shape-control)] transition-all active:scale-95 hover:bg-black/5 dark:hover:bg-white/10",
                      colors.panelBorder,
                      colors.textMain,
                      isSaving && "opacity-50 pointer-events-none",
                    )}
                  >
                    Use Full Image
                  </button>
                  <button
                    onClick={handleSaveCrop}
                    disabled={isSaving}
                    className={cn(
                      "flex items-center gap-2 px-6 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-[var(--shape-control)] transition-all active:scale-95 shadow-lg",
                      isSaving ? "opacity-50 cursor-not-allowed" : "hover:opacity-90",
                    )}
                    style={{
                      background: 'var(--aerie-selected-fill)',
                      color: 'var(--aerie-on-accent)',
                    }}
                  >
                    {isSaving ? (
                      <Upload size={14} className="animate-pulse" />
                    ) : (
                      <Check size={14} />
                    )}
                    {isSaving ? "Processing..." : "Apply Crop"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Matches the pill-tab style used by Agent / Integrations /
            Status / Packs so all wrapper apps share the same visual
            grammar for tab navigation. */}
        <div className={cn("overflow-hidden rounded-[var(--shape-control)] border mb-4 flex justify-center", colors.panelBg, colors.panelBorder)}>
          <div className="aerie-tabscroll flex gap-1.5 overflow-x-auto scrollbar-hide p-3">
          {(["appearance", "data"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setPane(null); }}
              className={cn(
                "shrink-0 rounded-[var(--shape-chip)] px-3 py-1.5 text-xs font-medium transition-colors border capitalize",
                colors.panelBorder,
                activeTab !== tab && colors.textMain,
              )}
              style={
                activeTab === tab
                  ? {
                      background: 'var(--aerie-selected-fill)',
                      color: 'var(--aerie-on-accent)',
                      borderColor: resolvedAccent
                    }
                  : undefined
              }
            >
              {tab}
            </button>
          ))}
          </div>
        </div>

        {/* No inner scroll container — AppShell already provides the
            scrollable body, so tabs scroll with content the way Agent /
            Integrations / Status do, instead of being pinned. */}
        <div className="space-y-8">
          {activeTab === "appearance" && (
            <>
              {pane === null && (
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { id: "theme", label: "Theme", hint: "Night & day, palettes, notes", Icon: Palette },
                    { id: "look", label: "Look & feel", hint: "Shape, bubbles, font, send button", Icon: Shapes },
                    { id: "home", label: "Home", hint: "Wallpapers and the dock", Icon: Home },
                    { id: "you", label: "You", hint: "Avatar, ring, names", Icon: UserRound },
                  ] as const).map(({ id, label, hint, Icon }) => (
                    <button
                      key={id}
                      onClick={() => setPane(id)}
                      className={cn("flex flex-col items-start gap-3 p-4 rounded-2xl border text-left transition-transform active:scale-[0.98]", colors.panelBg, colors.panelBorder)}
                    >
                      <Icon size={24} style={{ color: "var(--aerie-accent)" }} />
                      <span className={cn("text-sm font-bold", colors.textMain)}>{label}</span>
                      <span className={cn("text-[11px] leading-snug", colors.textMuted)}>{hint}</span>
                    </button>
                  ))}
                  {/* Lock screen, wide with a live preview, the way a phone's
                      own Personalize page has it. */}
                  <button
                    onClick={() => setPane("lock")}
                    className={cn("col-span-2 flex items-center justify-between gap-4 p-4 rounded-2xl border text-left transition-transform active:scale-[0.98]", colors.panelBg, colors.panelBorder)}
                  >
                    <span className="flex flex-col gap-1">
                      <span className={cn("text-sm font-bold", colors.textMain)}>Lock screen</span>
                      <span className={cn("text-[11px] leading-snug", colors.textMuted)}>Clock faces, shortcuts and more</span>
                    </span>
                    <LockPreview
                      face={lockFaceOf(theme.lockFace)}
                      position={lockPositionOf(theme.lockClockPosition)}
                      size={lockSizeOf(theme.lockClockSize)}
                      wallpaper={theme.lockScreenWallpaper || theme.wallpaper}
                      width={64}
                      at={lockClockAtOf(theme.lockClockAt, lockFaceOf(theme.lockFace))}
                      showClock={!lockHiddenOf(theme.lockHidden).has('clock')}
                    />
                  </button>
                </div>
              )}
              {pane !== null && (
                // A card that says where it goes, like everything else here;
                // a bare "< Personalize" didn't say.
                <button
                  onClick={() => setPane(null)}
                  className={cn("w-full flex items-center gap-2 p-3 rounded-2xl border text-left", colors.panelBg, colors.panelBorder, colors.textMain)}
                >
                  <ChevronLeft size={18} className={colors.accentText} />
                  <span className="text-sm font-semibold">Back to Personalize</span>
                </button>
              )}
              {pane === 'theme' && <ThemePane s={s} />}
              {pane === 'lock' && <LockPane s={s} />}
              {pane === 'you' && <YouPane s={s} />}
              {pane === 'look' && <LookPane s={s} />}
              {pane === 'home' && <HomePane s={s} />}
            </>
          )}



          {activeTab === "data" && <DataPane s={s} />}
        </div>
      </div>
    </AppShell>
  );
};
