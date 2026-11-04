// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React from "react";
import { Moon, Sun, Check, Plus } from "lucide-react";
import { PALETTE_THEME_IDS, THEMES } from "../../lib/theme";
import { cn } from "../../lib/utils";
import type { SettingsState } from './use-settings-state';

export function ThemePane({ s }: { s: SettingsState }) {
  const { colors, shownNoteColors, handleColorSelect, isColorSelected, theme, onThemeChange, onClose } = s;
  return (
    <>
    {/* Appearance Mode */}
    <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => onThemeChange({ mode: "light" })}
          className={cn(
            "flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl border transition-all duration-500",
            theme.mode === "light"
              ? `border-transparent`
              : `${colors.panelBg} ${colors.panelBorder} ${colors.accentText} hover:opacity-80`,
          )}
          style={
            theme.mode === "light"
              ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }
              : undefined
          }
        >
          <Sun size={16} strokeWidth={1.5} />
          <span className="text-[11px] font-bold uppercase tracking-widest">
            Daylight
          </span>
        </button>
        <button
          onClick={() => onThemeChange({ mode: "dark" })}
          className={cn(
            "flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl border transition-all duration-500",
            theme.mode === "dark"
              ? `border-transparent`
              : `${colors.panelBg} ${colors.panelBorder} ${colors.accentText} hover:opacity-80`,
          )}
          style={
            theme.mode === "dark"
              ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }
              : undefined
          }
        >
          <Moon size={16} strokeWidth={1.5} />
          <span className="text-[11px] font-bold uppercase tracking-widest">
            Midnight
          </span>
        </button>
      </div>
    </section>

    {/* The multi-color palettes, on their own page beside the
        themes above, so the differences are easy to see. */}
    <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
      <h3 className={cn("micro-label", colors.accentText)}>
        Palettes
      </h3>
      <div className="grid grid-cols-4 gap-3">
        {PALETTE_THEME_IDS.map((themeId) => {
          const t = THEMES[themeId];
          const p = t.palette!;
          const side = theme.mode === "dark" ? p.night : p.day;
          const isSelected = isColorSelected(themeId);
          return (
            <button
              key={themeId}
              onClick={() => handleColorSelect(themeId)}
              className={cn(
                "flex flex-col items-center gap-1.5 transition-all duration-300",
                isSelected ? "" : "opacity-75 hover:opacity-100",
              )}
            >
              <div
                className="relative w-full h-10 rounded-xl border-2"
                style={{
                  background: `linear-gradient(135deg, ${side.primary}, ${side.secondary})`,
                  borderColor: isSelected ? (theme.mode === "light" ? "#0B0B0B" : "#FFFFFF") : "transparent",
                  boxShadow: isSelected ? `0 0 18px ${side.primary}66` : undefined,
                }}
              >
                <span className="absolute right-1.5 bottom-1.5 flex gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: side.glow }} />
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: side.spark }} />
                </span>
                {isSelected && (
                  <Check size={16} strokeWidth={3} className="absolute left-1.5 top-1.5" style={{ color: theme.mode === "light" ? "#0B0B0B" : "#FFFFFF" }} />
                )}
              </div>
              <span className={cn("text-[9px] font-bold uppercase tracking-wide text-center leading-tight", colors.accentText, !isSelected && "opacity-70")}>
                {t.name}
              </span>
            </button>
          );
        })}
        {/* Custom stays now that the single-accent themes are retired. */}
        <button
          onClick={() => handleColorSelect("custom")}
          className={cn("flex flex-col items-center gap-1.5", isColorSelected("custom") ? "" : "opacity-75 hover:opacity-100")}
        >
          <div
            className="relative w-full h-10 rounded-xl border-2 border-dashed flex items-center justify-center"
            style={{
              borderColor: isColorSelected("custom") ? (theme.mode === "light" ? "#0B0B0B" : "#FFFFFF") : "var(--aerie-border)",
              background: theme.customColors?.[theme.mode]?.accent || "transparent",
            }}
          >
            {isColorSelected("custom") ? (
              <Check size={16} strokeWidth={3} style={{ color: theme.mode === "light" ? "#0B0B0B" : "#FFFFFF" }} />
            ) : (
              <Plus size={16} className={colors.textMuted} />
            )}
          </div>
          <span className={cn("text-[9px] font-bold uppercase tracking-wide text-center leading-tight", colors.accentText, !isColorSelected("custom") && "opacity-70")}>
            Custom
          </span>
        </button>
      </div>
    </section>

    {/* Custom Theme Editor */}
    {theme.id === "custom" && (
      <section
        className={cn(
          "space-y-4 p-4 rounded-2xl border",
          colors.panelBorder,
          colors.panelBg,
        )}
      >
        <div className="flex items-center justify-between">
          <h3 className={cn("micro-label", colors.accentText)}>
            Custom Theme Builder ({theme.mode} mode)
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onThemeChange({
                  customColors: {
                    light: {
                      pageBg: "#F4F4F5",
                      panelBg: "#FFFFFF",
                      panelBorder: "#E4E4E7",
                      textMain: "#18181B",
                      textMuted: "#71717A",
                      userBubbleBg: "#A1A1AA99",
                      userBubbleText: "#000000",
                      compBubbleBg: "#E4E4E799",
                      compBubbleText: "#000000",
                      accent: "#18181B",
                      accentText: "#18181B",
                    },
                    dark: {
                      pageBg: "#09090B",
                      panelBg: "#18181B",
                      panelBorder: "#27272A",
                      textMain: "#FAFAFA",
                      textMuted: "#A1A1AA",
                      userBubbleBg: "#52525B99",
                      userBubbleText: "#FFFFFF",
                      compBubbleBg: "#27272A99",
                      compBubbleText: "#FFFFFF",
                      accent: "#FAFAFA",
                      accentText: "#FAFAFA",
                    },
                  },
                });
              }}
              className={cn(
                "text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-[var(--shape-control)] border transition-colors",
                colors.panelBorder,
                colors.textMuted,
                "hover:opacity-80",
              )}
            >
              Reset
            </button>
            <button
              onClick={onClose}
              className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-[var(--shape-control)] transition-colors"
              style={{
                backgroundColor: 'var(--aerie-text)',
                color: 'var(--aerie-page)',
              }}
            >
              Save
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { key: "pageBg", label: "Page Background" },
            { key: "panelBg", label: "Panel Background" },
            { key: "panelBorder", label: "Panel Border" },
            { key: "textMain", label: "Main Text" },
            { key: "textMuted", label: "Muted Text" },
            { key: "userBubbleBg", label: "User Bubble Background" },
            { key: "userBubbleText", label: "User Bubble Text" },
            {
              key: "compBubbleBg",
              label: "Companion Bubble Background",
            },
            { key: "compBubbleText", label: "Companion Bubble Text" },
            { key: "accent", label: "Accent Background" },
            { key: "accentText", label: "Accent Text Color" },
          ].map(({ key, label }) => {
            const currentColor =
              theme.customColors?.[theme.mode]?.[key] || "#000000";
            const isValidHex = /^#[0-9A-F]{6}$/i.test(currentColor);
            const colorPickerValue = isValidHex
              ? currentColor
              : "#000000";

            return (
              <div
                key={key}
                className="flex items-center justify-between"
              >
                <span className={cn("text-xs", colors.textMain)}>
                  {label}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={currentColor}
                    onChange={(e) => {
                      const newColors = {
                        ...theme.customColors,
                        [theme.mode]: {
                          ...(theme.customColors?.[theme.mode] || {}),
                          [key]: e.target.value,
                        },
                      };
                      if (!newColors.light) newColors.light = {};
                      if (!newColors.dark) newColors.dark = {};
                      onThemeChange({
                        customColors: newColors as any,
                      });
                    }}
                    className={cn(
                      "text-[10px] font-mono bg-transparent border-none w-16 focus:outline-none text-center",
                      colors.textMuted,
                      colors.panelBorder,
                    )}
                  />
                  <input
                    type="color"
                    value={colorPickerValue}
                    onChange={(e) => {
                      const newColors = {
                        ...theme.customColors,
                        [theme.mode]: {
                          ...(theme.customColors?.[theme.mode] || {}),
                          [key]: e.target.value,
                        },
                      };
                      // Ensure both modes exist
                      if (!newColors.light) newColors.light = {};
                      if (!newColors.dark) newColors.dark = {};
                      onThemeChange({
                        customColors: newColors as any,
                      });
                    }}
                    className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    )}

    {/* Sticky Note Colors */}
    <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
      <div className="flex items-center justify-between">
        <h3 className={cn("micro-label", colors.accentText)}>
          Sticky Note Colors
        </h3>
        <button
          onClick={() => {
            // Clear the override rather than writing five fixed
            // colours back over it, so the notes follow the theme.
            onThemeChange({ stickyNoteColors: undefined });
          }}
          className={cn(
            "text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border opacity-70 hover:opacity-100 transition-opacity",
            colors.textMain,
            colors.panelBorder,
          )}
        >
          Use theme colors
        </button>
      </div>
      <div className="flex items-center justify-center gap-3">
        {shownNoteColors.map((color, index) => (
          <div key={index} className="relative group">
            <div
              className={cn(
                "w-10 h-10 rounded-lg border flex items-center justify-center overflow-hidden",
                colors.panelBorder,
              )}
              style={{ backgroundColor: color }}
            >
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  // Start from what is on screen, which is the
                  // theme's own set until the user overrides one.
                  const newColors = [...shownNoteColors];
                  newColors[index] = e.target.value;
                  onThemeChange({ stickyNoteColors: newColors });
                }}
                className="absolute inset-0 w-[200%] h-[200%] -top-1/2 -left-1/2 cursor-pointer opacity-0"
              />
            </div>
          </div>
        ))}
      </div>
    </section>

    </>
  );
}
