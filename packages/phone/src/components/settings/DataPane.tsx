// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React from "react";
import { Capacitor } from "@capacitor/core";
import { cn } from "../../lib/utils";
import { WebUiPassword } from "../WebUiPassword";
import { SetupSync } from "../SetupSync";
import { AppUpdate } from "../AppUpdate";
import { ClaudeCodeUpdate } from "../ClaudeCodeUpdate";
import { Toggle } from "../Toggle";
import { LaptopAppSettings } from "./LaptopPane";
import { useDesk } from "../../lib/use-desk";
import type { SettingsState } from './use-settings-state';

export function DataPane({ s }: { s: SettingsState }) {
  const { activeTheme, colors, handlePushToggle, theme, appSettings } = s;
  // The phone's own app is not shown on the laptop, and the laptop's is not
  // shown on the phone.
  const onDesk = useDesk(theme).on;
  return (
    <>
    {/* Backend & Worker URLs */}
    <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
      <h3 className={cn("micro-label", colors.accentText)}>
        Notifications
      </h3>
      <div className="flex items-center justify-between">
          <div className="text-left">
            <span
              className={cn(
                "block text-sm font-medium",
                colors.textMain,
              )}
            >
              Push Notifications
            </span>
            <span className={cn("text-xs", colors.textMuted)}>
              {Capacitor.isNativePlatform() ? "Enable native push notifications" : "Get notifications in this browser"}
            </span>
          </div>
          <Toggle
            on={!!appSettings.pushNotificationsEnabled}
            onClick={handlePushToggle}
            colors={colors}
            ariaLabel="Toggle push notifications"
          />
      </div>
    </section>

    {/* Web UI Password — moved from Agent → Models since it's a
        security setting, not an agent setting. Saves to YAML via
        the same PUT /api/preferences endpoint PreferencesApp used. */}
    <WebUiPassword themeConfig={activeTheme} themeMode={theme.mode} />

    {/* Setup Sync — explicit send/bring of the whole device setup,
        extras included. The passive sync covers the big three;
        this is the deliberate lane for new browsers and the APK. */}
    <SetupSync themeConfig={activeTheme} themeMode={theme.mode} />

    {/* Android shell updates. The version/download routes shipped
        with the shell and nothing ever called them, so installing a
        new build meant typing the URL by hand. Stays silent unless
        the native layer actually moved. */}
    {!onDesk && <AppUpdate themeConfig={activeTheme} themeMode={theme.mode} />}

    {/* The laptop app's own version, update and Start with Windows; it
        draws nothing anywhere but inside the laptop app. */}
    <LaptopAppSettings s={s} />

    {/* The Claude Code the lanes run, updated from here (ClaudeCodeUpdate.tsx). */}
    <ClaudeCodeUpdate themeConfig={activeTheme} themeMode={theme.mode} />
    </>
  );
}
