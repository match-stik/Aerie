// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React from "react";
import { Image as ImageIcon, Upload } from "lucide-react";
import { cn } from "../../lib/utils";
import { Toggle } from "../Toggle";
import { DESK_DOCK_MAX, DESK_MIN_WIDTH, aspectWords, deskDockIdsOf, deskDockOf, deskChatOf, deskLayoutOf, type DeskDock, type DeskChat, type DeskLayout } from "../../lib/desk";
import { useRoomAspect } from "../../lib/use-room-aspect";
import { laptopApp } from "../../lib/laptop-app";
import { APPS, migrateAppIds, useAppName } from "../../lib/apps";
import { SLIDESHOW_PACES, paceLabel, slideshowSecondsOf } from "../../lib/slideshow";
import type { SettingsState } from './use-settings-state';

// The house on a wide screen (lib/desk.ts). These ride in the theme like
// every other look, so they can set the laptop from their phone and the other
// way round; the layout rows only ever show on a window wide enough for them.
export function LaptopPane({ s }: { s: SettingsState }) {
  const { colors, theme, onThemeChange, handleImageUpload } = s;
  const layout = deskLayoutOf(theme.deskLayout);
  const study = layout === 'study';
  const room = useRoomAspect();
  const nameOf = useAppName();
  const dock = deskDockOf(theme.deskDock);
  const dockMax = DESK_DOCK_MAX[dock];
  const ownDock = deskDockIdsOf(theme.deskDockAppIds);
  const phoneDock = migrateAppIds(s.appSettings.dockAppIds ?? APPS.filter((x) => x.dock).map((x) => x.id));
  const dockIds = ownDock ? migrateAppIds(ownDock) : phoneDock;
  // The Aerie app on their laptop, when this is it (desktop/): its version,
  // starting with Windows, and its update.
  const app = laptopApp();
  const [about, setAbout] = React.useState<{ version: string; startWithWindows: boolean | null } | null>(null);
  const [update, setUpdate] = React.useState<string | null>(null);
  const [newer, setNewer] = React.useState(false);
  React.useEffect(() => {
    if (!app) return;
    void app.about().then(setAbout).catch(() => {});
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
    setUpdate('Downloading... the app will close and come back on its own.');
    const answer = await app.installUpdate().catch((e: unknown) => ({ ok: false, error: String(e) }));
    if (!answer.ok) setUpdate(answer.error || "The update didn't start.");
  };

  // One row of chips, the way Home's card rows are drawn.
  const chips = <T extends string | number>(options: [T, string][], value: T, onPick: (id: T) => void, cols: string) => (
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

  return (
    <>
      <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
        <h3 className={cn("micro-label", colors.accentText)}>On a wide screen</h3>
        <div className="space-y-1.5">
          <span className={cn("text-xs font-bold", colors.textMain)}>Layout</span>
          {chips<DeskLayout>([["study", "Study"], ["phone", "Phone"]], layout, (id) => onThemeChange({ deskLayout: id }), "grid-cols-2")}
          <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
            Study gives one room the stage and keeps the conversation open beside it. Phone is the house as it was, stretched. Either way a window narrower than {DESK_MIN_WIDTH}px is the phone.
          </p>
        </div>
        {study && (
          <>
            <div className="space-y-1.5">
              <span className={cn("text-xs font-bold", colors.textMain)}>Dock</span>
              {chips<DeskDock>([["left", "Left side"], ["top", "Top"]], deskDockOf(theme.deskDock), (id) => onThemeChange({ deskDock: id }), "grid-cols-2")}
              <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
                Left side stands the dock on its end beside every room. Top floats it across the headers, over every room.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className={cn("text-xs font-bold", colors.textMain)}>Apps in the dock</span>
                <span className="flex items-center gap-3">
                  <span className={cn("text-[11px] font-bold", colors.textMuted)}>{Math.min(dockIds.length, dockMax)} of {dockMax}</span>
                  {ownDock && (
                    <button
                      onClick={() => onThemeChange({ deskDockAppIds: undefined })}
                      className="text-[10px] font-bold uppercase tracking-widest opacity-80 hover:opacity-100"
                      style={{ color: colors.accent }}
                    >
                      Same as phone
                    </button>
                  )}
                </span>
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
                Home, Apps and Lock are always there. Down the left side holds {DESK_DOCK_MAX.left}; along the top holds {DESK_DOCK_MAX.top}, so it stays clear of a room's title. Until you pick, it's the same as your phone's dock.
              </p>
            </div>
            <div className="space-y-1.5">
              <span className={cn("text-xs font-bold", colors.textMain)}>The conversation sits</span>
              {chips<DeskChat>([["left", "Left"], ["right", "Right"], ["tucked", "Tucked"]], deskChatOf(theme.deskChat), (id) => onThemeChange({ deskChat: id }), "grid-cols-3")}
              <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
                Tucked puts it away, and Messages opens on the stage like any other room.
              </p>
            </div>
          </>
        )}
      </section>

      {app && (
        <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
          <h3 className={cn("micro-label", colors.accentText)}>The laptop app</h3>
          {about?.startWithWindows !== null && about !== null && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className={cn("text-xs font-bold", colors.textMain)}>Start with Windows</span>
                <span className={cn("text-[10px]", colors.textMuted)}>Opens tucked by the clock when you sign in, so we can reach you</span>
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
            Closing the window tucks it down by the clock; Quit is on that icon's menu.
          </p>
        </section>
      )}

      {/* The laptop's own pictures. Cropped wide; Use Full
          Image keeps the whole picture. An empty one shows the phone's. */}
      <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
        <h3 className={cn("micro-label", colors.accentText)}>Wallpapers</h3>
        <div className="grid grid-cols-2 gap-3">
          {([["desk", "The room", theme.deskWallpaper, "deskWallpaper"], ["desklock", "Lock screen", theme.deskLockWallpaper, "deskLockWallpaper"]] as const).map(([target, label, src, key]) => (
            <div key={target} className="space-y-2">
              <div className={cn("relative aspect-[16/10] rounded-xl border-2 border-dashed overflow-hidden flex items-center justify-center group", colors.panelBorder)}>
                <label className="absolute inset-0 cursor-pointer z-10" aria-label={`Choose the laptop's ${label.toLowerCase()} wallpaper`}>
                  <input type="file" onChange={(e) => handleImageUpload(e, target)} className="hidden" accept="image/*" />
                </label>
                {src ? (
                  <>
                    <img src={src} className="w-full h-full object-cover" alt="" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Upload size={20} className="text-white" />
                    </div>
                  </>
                ) : (
                  <ImageIcon size={24} className={colors.textMuted} strokeWidth={1.5} />
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className={cn("text-xs font-bold", colors.textMain)}>{label}</span>
                {src && (
                  <button
                    onClick={() => onThemeChange({ [key]: undefined })}
                    className="text-[10px] font-bold uppercase tracking-widest opacity-80 hover:opacity-100"
                    style={{ color: colors.accent }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
          These only show on the laptop. Leave one empty and the laptop shows the phone's picture there instead.
        </p>
        {room && (
          <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
            The room is {room.width} by {room.height} right now ({aspectWords(room.width / room.height)}). The picture fills the room and trims whatever hangs over, never stretched; a new room picture is cropped to the room's shape, so you choose what shows. Moving the conversation changes the shape.
          </p>
        )}
      </section>

      {/* The slideshow's pace and order. They follow the slideshow wherever it
          plays, the phone too; they live here because a wall this size is
          where ten seconds a picture started to feel fast. */}
      <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
        <h3 className={cn("micro-label", colors.accentText)}>Slideshow</h3>
        <div className="space-y-1.5">
          <span className={cn("text-xs font-bold", colors.textMain)}>Change every</span>
          {chips<number>(SLIDESHOW_PACES.map((p) => [p, paceLabel(p)] as [number, string]), slideshowSecondsOf(theme.slideshowSeconds), (id) => onThemeChange({ slideshowSeconds: slideshowSecondsOf(id) }), "grid-cols-4")}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className={cn("text-xs font-bold", colors.textMain)}>Shuffle</span>
            <span className={cn("text-[10px]", colors.textMuted)}>Any picture next, instead of the order you added them</span>
          </span>
          <Toggle
            on={theme.slideshowShuffle === true}
            onClick={() => onThemeChange({ slideshowShuffle: !theme.slideshowShuffle })}
            colors={colors}
            ariaLabel="Shuffle the slideshow"
          />
        </div>
        <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
          These follow the slideshow on the phone as well. The pictures themselves are under Home.
        </p>
      </section>
    </>
  );
}
