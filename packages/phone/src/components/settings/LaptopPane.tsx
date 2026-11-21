// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React from "react";
import { cn } from "../../lib/utils";
import { Toggle } from "../Toggle";
import { DESK_DOCK_MAX, deskDockIdsOf, deskDockOf, deskChatOf, type DeskDock, type DeskChat } from "../../lib/desk";
import { laptopApp, reportFromLaptop, type LaptopAbout } from "../../lib/laptop-app";
import { APPS, migrateAppIds, useAppName } from "../../lib/apps";
import type { SettingsState } from './use-settings-state';

// The laptop's own pieces of Settings (lib/desk.ts). There is no Desktop page
// of its own any more: the dock sits under Home, where the phone's
// dock is, and the laptop app sits under Data, where the phone's own app
// update is. The Phone layout is gone too (same night: 'the phone layout
// stretches so bad'); a narrow window is still the phone.

type Colors = SettingsState['colors'];

// One row of chips, the way Home's card rows are drawn.
function Chips<T extends string | number>({ colors, options, value, onPick, cols }: { colors: Colors; options: [T, string][]; value: T; onPick: (id: T) => void; cols: string }) {
  return (
    <div className={cn("grid gap-2", cols)}>
      {options.map(([id, label]) => {
        const on = value === id;
        return (
          <button
            key={String(id)}
            onClick={() => onPick(id)}
            className={cn('px-3 py-2 rounded-xl border text-[11px] font-bold uppercase tracking-widest', colors.panelBorder, colors.textMain)}
            style={on ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: colors.accent } : undefined}
            aria-pressed={on}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Where the laptop's dock sits, which apps are in it, and where the conversation sits: under Home on the laptop. */
export function LaptopDockSettings({ s }: { s: SettingsState }) {
  const { colors, theme, onThemeChange } = s;
  const nameOf = useAppName();
  const dock = deskDockOf(theme.deskDock);
  const dockMax = DESK_DOCK_MAX[dock];
  const ownDock = deskDockIdsOf(theme.deskDockAppIds);
  const phoneDock = migrateAppIds(s.appSettings.dockAppIds ?? APPS.filter((x) => x.dock).map((x) => x.id));
  const dockIds = ownDock ? migrateAppIds(ownDock) : phoneDock;
  return (
    <>
      <div className="space-y-1.5">
        <span className={cn("text-xs font-bold", colors.textMain)}>Where it sits</span>
        <Chips<DeskDock> colors={colors} options={[["left", "Left side"], ["top", "Top"]]} value={dock} onPick={(id) => onThemeChange({ deskDock: id })} cols="grid-cols-2" />
        <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
          Left side stands the dock on its end beside every room. Top floats it across the headers, over every room.
        </p>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-xs font-bold", colors.textMain)}>Apps in the dock</span>
          <span className={cn("text-[11px] font-bold", colors.textMuted)}>{Math.min(dockIds.length, dockMax)} of {dockMax}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[...APPS].filter((a) => a.id !== 'settings').sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((app) => {
            const isOn = dockIds.includes(app.id);
            const atCap = !isOn && dockIds.length >= dockMax;
            return (
              <button
                key={`deskdock-${app.id}`}
                onClick={() => {
                  if (atCap) return;
                  onThemeChange({ deskDockAppIds: isOn ? dockIds.filter((id) => id !== app.id) : [...dockIds, app.id] });
                }}
                disabled={atCap}
                className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border text-xs text-left disabled:opacity-40', colors.panelBorder, colors.textMain)}
                style={isOn ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: colors.accent } : undefined}
              >
                <app.icon size={14} />
                <span className="flex-1 truncate">{nameOf(app)}</span>
              </button>
            );
          })}
        </div>
        <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
          Home, Apps and Lock are always there. Down the left side holds {DESK_DOCK_MAX.left}; along the top holds {DESK_DOCK_MAX.top}, so it stays clear of a room's title.
        </p>
      </div>
      <div className="space-y-1.5">
        <span className={cn("text-xs font-bold", colors.textMain)}>The conversation sits</span>
        <Chips<DeskChat> colors={colors} options={[["left", "Left"], ["right", "Right"], ["tucked", "Tucked"]]} value={deskChatOf(theme.deskChat)} onPick={(id) => onThemeChange({ deskChat: id })} cols="grid-cols-3" />
        <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
          Tucked puts it away, and Messages opens on the stage like any other room.
        </p>
      </div>
    </>
  );
}

/** The Aerie app on their laptop (desktop/): its version, starting with Windows, and its update. Under Data on the laptop, where the phone keeps its own app's update. */
export function LaptopAppSettings({ s }: { s: SettingsState }) {
  const { colors } = s;
  // The Aerie app on their laptop, when this is it (desktop/): its version,
  // starting with Windows, and its update.
  const app = laptopApp();
  const [about, setAbout] = React.useState<LaptopAbout | null>(null);
  const [update, setUpdate] = React.useState<string | null>(null);
  const [newer, setNewer] = React.useState(false);
  React.useEffect(() => {
    if (!app) return;
    void app.about().then((a) => {
      setAbout(a);
      // The app reads its own update.log once at start; say how the update
      // went here and in the house's log, so a failed one is never silent.
      const last = a.lastUpdate;
      if (last) {
        const moved = last.from && last.from !== last.to ? `${last.from} to ${last.to}` : `still ${last.to}`;
        setUpdate(last.ok && last.from !== last.to ? `Updated: ${moved}.` : `The last update didn't take (${moved}): ${last.note}`);
        reportFromLaptop('update', `${last.ok ? 'ok' : 'failed'} ${moved}: ${last.note}`);
      }
    }).catch(() => {});
  }, [app]);
  const check = async () => {
    if (!app) return;
    setUpdate('Checking...');
    const answer = await app.checkUpdate().catch(() => null);
    if (!answer) { setUpdate("Couldn't reach the house."); return; }
    setNewer(answer.newer);
    // No version from the house is not the same as nothing newer: until the
    // house's own restart its version answer did not exist, and this said
    // 'You have the newest' to an app two versions behind.
    if (!answer.latest) { setUpdate(`You have ${answer.current}. The house didn't say which version it holds, so this couldn't tell.`); return; }
    setUpdate(answer.newer ? `Version ${answer.latest} is ready.` : `You have the newest (${answer.current}).`);
  };
  const install = async () => {
    if (!app) return;
    setUpdate('Downloading... the app will close, and come back on its own in a minute or two.');
    const answer = await app.installUpdate().catch((e: unknown) => ({ ok: false, error: String(e) }));
    if (!answer.ok) setUpdate(answer.error || "The update didn't start.");
  };

  if (!app) return null;
  return (
    <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
      <h3 className={cn("micro-label", colors.accentText)}>The laptop app</h3>
      {about?.startWithWindows !== null && about !== null && (
        <div className="flex items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className={cn("text-xs font-bold", colors.textMain)}>Start with Windows</span>
            <span className={cn("text-[10px]", colors.textMuted)}>Opens tucked away in the system tray when you sign in, so your companions can still reach you</span>
          </span>
          <Toggle
            on={about.startWithWindows === true}
            onClick={() => { void app.setStartWithWindows(!about.startWithWindows).then((on) => setAbout({ ...about, startWithWindows: on })); }}
            colors={colors}
            ariaLabel="Start with Windows"
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className={cn("text-xs font-bold", colors.textMain)}>Version {about?.version ?? '...'}</span>
          <span className={cn("text-[10px]", colors.textMuted)}>{update ?? 'Everything inside updates with the house. This is only the frame around it.'}</span>
        </span>
        <button
          onClick={() => { void (newer ? install() : check()); }}
          className={cn('px-3 py-2 rounded-xl border text-[11px] font-bold uppercase tracking-widest shrink-0', colors.panelBorder, colors.textMain)}
          style={newer ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: colors.accent } : undefined}
        >
          {newer ? 'Update' : 'Check'}
        </button>
      </div>
      <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
        Closing the window tucks it into the system tray, the little icons by the clock. To quit, right-click its icon there.
      </p>
    </section>
  );
}
