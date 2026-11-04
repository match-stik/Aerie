// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Their theme outside the screens that wear it: what the phone remembers between
// opens, the system bars and page behind the apps, and the custom palette's
// stylesheet. App.tsx holds the state and hands it in.

import { useEffect, useMemo } from 'react';
import { paintSystemBars } from '../aerie/system-chrome';
import { barColorsFor } from './system-bar-colors';
import { guardTheme } from './theme-guard';
import { THEMES, resolveThemeColors, setLivePalette } from './theme';
import type { AppTheme } from '../types';

export const KNOWN_THEME_IDS: ReadonlySet<string> = new Set(Object.keys(THEMES));

export const DEFAULT_THEME: AppTheme = {
  mode: 'dark',
  id: 'pal-smoke',
};

export function readSavedTheme(): AppTheme {
  const saved = localStorage.getItem('aerie_theme');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Handle legacy theme migration
      if (parsed.accentColor) {
        return { mode: parsed.mode || 'dark', id: 'pal-obsidian' };
      }
      
      // Handle theme name migrations
      if (parsed.id === 'light-orange') parsed.id = 'peach';
      if (parsed.id === 'light-yellow') parsed.id = 'lemon';
      if (parsed.id === 'light-blue') parsed.id = 'sky';

      // Strip wallpapers from localStorage load to prevent flashing old cached wallpapers
      // that failed to update due to quota limits
      delete parsed.wallpaper;
      delete parsed.lockScreenWallpaper;
      delete parsed.wallpapers;
      delete parsed.modeWallpapers;
      return guardTheme(parsed, KNOWN_THEME_IDS);
    } catch (e) {}
  }
  return DEFAULT_THEME;
}

export function useThemeFrame(theme: AppTheme, osState: string, showSettings: boolean) {
  // Update theme-color meta tag, Native Status Bar, and Body Background
  useEffect(() => {
    const activeTheme = THEMES[theme.id] || THEMES['monochrome'];
    const colors = activeTheme[theme.mode];
    setLivePalette(activeTheme.palette, theme.mode);
    const resolved = resolveThemeColors(colors);
    const pageBgColor = theme.id === 'custom'
      ? (theme.customColors?.[theme.mode]?.pageBg || (theme.mode === 'light' ? '#FFFFFF' : '#000000'))
      : resolved.pageBg;

    // The frame: white in Daylight, black in Midnight, top
    // and bottom, with the page color living inside it. Which screen wears
    // what is decided in lib/system-bar-colors.ts.
    const { bars: themeColor, body: bodyColor } = barColorsFor({
      mode: theme.mode,
      osState,
      hasWallpaper: !!theme.wallpaper,
      showSettings,
      pageBg: pageBgColor,
    });

    // Replace the meta node instead of mutating it — Chrome-on-Android
    // PWAs often skip repainting the status bar when only the content
    // attribute changes, which left the previous mode's color up top
    // until the app was fully relaunched.
    document.querySelector('meta[name="theme-color"]')?.remove();
    const metaThemeColor = document.createElement('meta');
    metaThemeColor.setAttribute('name', 'theme-color');
    metaThemeColor.setAttribute('content', themeColor);
    document.head.appendChild(metaThemeColor);
    
    // The page behind the apps (lib/system-bar-colors.ts): the frame's color,
    // so the instant after a keyboard closes shows the footer, not a block.
    document.body.style.backgroundColor = bodyColor;
    document.documentElement.style.backgroundColor = bodyColor;

    // Update Native Capacitor / Cordova properties
    const cap = (window as any).Capacitor;
    if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
      const syncNativeBars = async () => {
        // The APK's bars belong to the native window, so the meta above never
        // reaches them; the app's own SystemChrome plugin paints both, the
        // strip under the footer the same color as the one over the header.
        await paintSystemBars(themeColor);
      };
      syncNativeBars();
    }
  }, [theme, osState, showSettings]);
}

export function useCustomThemeStyles(theme: AppTheme) {
  return useMemo(() => {
    if (theme.id !== 'custom' || !theme.customColors) return null;
    const modeColors = theme.customColors[theme.mode];
    
    // Default to monochrome logic if custom colors are missing
    const isDark = theme.mode === 'dark';
    
    return `
      :root {
        --custom-pageBg: ${modeColors.pageBg || (isDark ? '#09090B' : '#F4F4F5')};
        --custom-panelBg: ${modeColors.panelBg || (isDark ? '#18181B' : '#ffffff')};
        --custom-panelBorder: ${modeColors.panelBorder || (isDark ? '#FAFAFA' : '#18181B')};
        --custom-textMain: ${modeColors.textMain || (isDark ? '#FAFAFA' : '#18181B')};
        --custom-textMuted: ${modeColors.textMuted || (isDark ? '#FAFAFA' : '#18181B')};
        --custom-userBubbleBg: ${modeColors.userBubbleBg || (isDark ? '#FAFAFA' : '#18181B')};
        --custom-userBubbleText: ${modeColors.userBubbleText || (isDark ? '#09090B' : '#ffffff')};
        --custom-compBubbleBg: ${modeColors.compBubbleBg || (isDark ? '#FAFAFA' : '#18181B')};
        --custom-compBubbleText: ${modeColors.compBubbleText || (isDark ? '#FAFAFA' : '#18181B')};
        --custom-accent: ${modeColors.accent || (isDark ? '#FAFAFA' : '#18181B')};
        --custom-accentText: ${modeColors.accentText || modeColors.accent || (isDark ? '#FAFAFA' : '#18181B')};
      }
    `;
  }, [theme]);
}
