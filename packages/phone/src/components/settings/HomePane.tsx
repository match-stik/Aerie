// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React from "react";
import { X, Moon, Sun, Image as ImageIcon, Upload, Home } from "lucide-react";
import { APPS, migrateAppIds } from "../../lib/apps";
import { cn } from "../../lib/utils";
import { Toggle } from "../Toggle";
import { HOME_WIDGETS, homeWidgetsOf, toggleWidget } from "../../lib/home-widgets";
import type { SettingsState } from './use-settings-state';

export function HomePane({ s }: { s: SettingsState }) {
  const { colors, nameOf, handleImageUpload, removeSlideshowImage, theme, appSettings, onThemeChange, onSettingsChange, onClose } = s;
  return (
    <>
    {/* A wallpaper for each mode. */}
    <section className={cn("space-y-3 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className={cn("micro-label", colors.accentText)}>
          Day & Night Wallpapers
        </h3>
        <Toggle
          on={!!theme.wallpaperFollowsMode}
          onClick={() => onThemeChange({ wallpaperFollowsMode: !theme.wallpaperFollowsMode })}
          colors={colors}
          ariaLabel="Separate wallpapers for Daylight and Midnight"
        />
      </div>
      <p className={cn("text-[11px] leading-relaxed", colors.textMuted)}>
        {theme.wallpaperFollowsMode
          ? `On. Pick a mode here and set its wallpapers below; this is your ${theme.mode === "dark" ? "Midnight" : "Daylight"} set right now. They swap on their own whenever you switch.`
          : "Off. One set of wallpapers for both modes."}
      </p>
      {/* The switch sits with the wallpapers so the mode can be flipped
          and set without leaving this page. It is the real mode flip,
          so the sets swap exactly as they do anywhere else. */}
      {theme.wallpaperFollowsMode && (
        <div className="grid grid-cols-2 gap-3">
          {([
            { mode: "light", label: "Daylight", Icon: Sun },
            { mode: "dark", label: "Midnight", Icon: Moon },
          ] as const).map(({ mode, label, Icon }) => {
            const on = theme.mode === mode;
            return (
              <button
                key={mode}
                onClick={() => { if (!on) onThemeChange({ mode }); }}
                className={cn(
                  "flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl border transition-all duration-300",
                  on ? "border-transparent" : `${colors.panelBg} ${colors.panelBorder} ${colors.accentText} hover:opacity-80`,
                )}
                style={on ? { background: "var(--aerie-selected-fill)", color: "var(--aerie-on-accent)" } : undefined}
                aria-pressed={on}
              >
                <Icon size={16} strokeWidth={1.5} />
                <span className="text-[11px] font-bold uppercase tracking-widest">{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>

    {/* Wallpaper */}
    <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
      <div className="flex items-center justify-between">
        <h3 className={cn("micro-label", colors.accentText)}>
          Atmosphere
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-widest",
              colors.textMuted,
            )}
          >
            Slideshow
          </span>
          <Toggle
            on={!!theme.slideshowEnabled}
            onClick={() =>
              onThemeChange({
                slideshowEnabled: !theme.slideshowEnabled,
              })
            }
            colors={colors}
            ariaLabel="Toggle slideshow"
          />
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {!theme.slideshowEnabled ? (
          <div className="flex gap-6 items-center">
            <div
              className={cn(
                "w-24 h-32 shrink-0 rounded-[calc(24px*var(--shape-scale,1))] border-2 border-dashed flex items-center justify-center overflow-hidden relative group transition-all duration-500",
                colors.panelBg,
                colors.panelBorder,
                "hover:border-opacity-50",
              )}
            >
              <label className="absolute inset-0 cursor-pointer z-10">
                <input
                  type="file"
                  onChange={(e) => handleImageUpload(e, "single")}
                  className="hidden"
                  accept="image/*"
                />
              </label>
              {theme.wallpaper ? (
                <>
                  <img
                    src={theme.wallpaper}
                    className="w-full h-full object-cover opacity-60"
                    alt="Wallpaper"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Upload size={24} className="text-white" />
                  </div>
                </>
              ) : (
                <ImageIcon
                  size={28}
                  className={colors.textMuted}
                  strokeWidth={1.5}
                />
              )}
            </div>
            <div className="flex-1 space-y-3">
              <p
                className={cn(
                  "text-xs leading-relaxed font-medium text-left",
                  colors.textMuted,
                )}
              >
                Home Screen Background
              </p>
              {theme.wallpaper && (
                <button
                  onClick={() =>
                    onThemeChange({ wallpaper: undefined })
                  }
                  className="text-[10px] font-bold uppercase tracking-widest transition-colors opacity-80 hover:opacity-100"
                  style={{ color: colors.accent }}
                >
                  Reset Home Screen
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p
              className={cn(
                "text-xs leading-relaxed font-medium text-center",
                colors.textMuted,
              )}
            >
              Home Screen Slideshow (up to 10 images)
            </p>
            <div className="grid grid-cols-4 gap-3 pb-2">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => {
                const wp = theme.wallpapers?.[index];
                return (
                  <div
                    key={index}
                    className={cn(
                      "w-full h-28 rounded-[calc(16px*var(--shape-scale,1))] border-2 border-dashed flex items-center justify-center overflow-hidden relative group transition-all duration-500",
                      colors.panelBg,
                      colors.panelBorder,
                      "hover:border-opacity-50",
                      index === 8 ? "col-start-2" : "",
                      index === 9 ? "col-start-3" : "",
                    )}
                  >
                    <label className="absolute inset-0 cursor-pointer z-10">
                      <input
                        type="file"
                        onChange={(e) => handleImageUpload(e, index)}
                        className="hidden"
                        accept="image/*"
                      />
                    </label>
                    {wp ? (
                      <>
                        <img
                          src={wp}
                          className="w-full h-full object-cover opacity-60"
                          alt={`Wallpaper ${index + 1}`}
                        />
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity gap-2">
                          <Upload size={16} className="text-white" />
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              removeSlideshowImage(index);
                            }}
                            className={cn(
                              "aerie-on-accent p-1 rounded-full relative z-20 hover:scale-110 transition-transform",
                            )}
                            style={{ backgroundColor: colors.accent }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <ImageIcon
                        size={20}
                        className={colors.textMuted}
                        strokeWidth={1.5}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>

    {/* Home widgets. A long press on the home screen
        opens the same choices. */}
    <section className={cn("space-y-3 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
      <h3 className={cn("micro-label", colors.accentText)}>Widgets</h3>
      <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
        They sit low on your home screen so your wallpaper keeps the top. Holding an empty spot on the home screen opens these too, and holding a widget lets you put it anywhere on the grid.
      </p>
      <div className="space-y-2">
        {HOME_WIDGETS.map((w) => {
          const on = homeWidgetsOf(theme.homeWidgets).includes(w.id);
          return (
            <button
              key={`widget-${w.id}`}
              onClick={() => onThemeChange({ homeWidgets: toggleWidget(homeWidgetsOf(theme.homeWidgets), w.id) })}
              className={cn('flex w-full items-center justify-between gap-3 px-3 py-2.5 rounded-xl border text-left', colors.panelBorder, colors.textMain)}
              style={on ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: colors.accent } : undefined}
            >
              <span className="flex flex-col">
                <span className="text-xs font-bold">{w.label}</span>
                <span className="text-[10px] opacity-75">{w.hint}</span>
              </span>
              <span className="text-[10px] font-bold tracking-widest">{w.cols}×{w.rows}</span>
            </button>
          );
        })}
        <button
          onClick={() => onThemeChange({ homeQuietLine: !theme.homeQuietLine })}
          className={cn('flex w-full items-center justify-between gap-3 px-3 py-2.5 rounded-xl border text-left', colors.panelBorder, colors.textMain)}
          style={theme.homeQuietLine ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: colors.accent } : undefined}
        >
          <span className="flex flex-col">
            <span className="text-xs font-bold">Quiet line</span>
            <span className="text-[10px] opacity-75">One line of the latest reply, riding on the dock</span>
          </span>
        </button>
        {theme.homeWidgetSpots && Object.keys(theme.homeWidgetSpots).length > 0 && (
          <button
            onClick={() => onThemeChange({ homeWidgetSpots: undefined })}
            className={cn('flex w-full items-center justify-center px-3 py-2.5 rounded-xl border text-[11px] font-bold uppercase tracking-widest', colors.panelBorder, colors.accentText)}
          >
            Put the widgets back
          </button>
        )}
      </div>
    </section>

    {/* Dock apps */}
    <section className={cn("space-y-3 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
      <h3 className={cn("micro-label", colors.accentText)}>
        Home dock
      </h3>
      <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
        Up to 4 apps. The App Drawer launcher is always last.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {[...APPS].filter((a) => a.id !== 'settings').sort((a, b) => a.name.localeCompare(b.name)).map((app) => {
          const current = migrateAppIds(appSettings.dockAppIds ?? APPS.filter((x) => x.dock).map((x) => x.id));
          const isOn = current.includes(app.id);
          const atCap = !isOn && current.length >= 4;
          return (
            <button
              key={`dock-${app.id}`}
              onClick={() => {
                if (atCap) return;
                const next = isOn
                  ? current.filter((id) => id !== app.id)
                  : [...current, app.id];
                onSettingsChange({ dockAppIds: next });
              }}
              disabled={atCap}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl border text-xs text-left disabled:opacity-40',
                colors.panelBorder,
                colors.textMain,
              )}
              style={isOn ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: colors.accent } : undefined}
            >
              <app.icon size={14} />
              <span className="flex-1 truncate">{app.name}</span>
            </button>
          );
        })}
      </div>

      {/* Apply Settings + Version */}
      <div className="pt-4 flex flex-col items-center gap-3">
        <button
          onClick={onClose}
          className="w-full py-3 rounded-2xl font-bold text-sm transition-all duration-500 hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: 'var(--aerie-selected-fill)',
            color: 'var(--aerie-on-accent)',
          }}
        >
          Apply Settings
        </button>
        <div
          className={cn(
            "text-[10px] font-mono tracking-widest uppercase opacity-40",
            colors.textMuted,
          )}
        >
          Aerie v3.2.5
        </div>
      </div>
    </section>
    </>
  );
}
