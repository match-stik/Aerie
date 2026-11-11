// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React from "react";
import { AppTheme } from "../../types";
import { QuickReactionsSetting } from "../QuickReactionsSetting";
import { resolveThemeColors, themeRadiusPx } from "../../lib/theme";
import { APPS, drawerColumnsOf } from "../../lib/apps";
import { cn } from "../../lib/utils";
import { SEND_ICONS, DEFAULT_SEND_ICON_ID } from "../../lib/sendIcons";
import { bubbleCorners, bubbleLookOf, nameColor } from "../../lib/bubble-look";
import { BubbleSkin, SKINNED } from "../BubbleSkin";
import { drawerIconPx, drawerLookOf, drawerTileStyle } from "../../lib/drawer-look";
import { BODY_FONTS, FONT_SCALE_MAX, FONT_SCALE_MIN, TITLE_FONTS, TITLE_SCALE_MAX, TITLE_SCALE_MIN, bodyStack, fontsOf, titleStack } from "../../lib/fonts";
import { AppLabel } from "../AppLabel";
import type { SettingsState } from './use-settings-state';

// A stand-in companion for the bubble preview: a neutral name and color, not
// any real companion in the house.
const SAMPLE_COMPANION = { slug: "cedar", name: "Cedar", color: "#0d9488" };

export function LookPane({ s }: { s: SettingsState }) {
  const { oursPreviewRef, minePreviewRef, activeTheme, colors, zoom, theme, appSettings, onThemeChange, onSettingsChange, ownerName, emojiPacks } = s;
  const shapePreviewRef = React.useRef<HTMLSpanElement>(null);
  return (
    <>
    {(() => {
      // The shape slider, which rounds the whole phone, and under it the
      // Bubbles switches (lib/bubble-look.ts), each starting as the
      // bubbles look today, with a preview drawn by the same rules the
      // chat uses. The slider changes everything, so they live here.
      const look = bubbleLookOf(theme);
      const SWITCHES: { key: "bubbleFaces" | "bubbleNames" | "bubbleMyName" | "bubbleEdges" | "bubbleQuietActions" | "bubblePlainWords"; on: boolean; label: string; hint: string }[] = [
        { key: "bubbleFaces", on: look.faces, label: "Faces", hint: "Companion faces beside their bubbles, and yours beside yours" },
        { key: "bubbleNames", on: look.names, label: "Names", hint: `Each companion named ${look.tailOurs === "bottom" ? "under" : "over"} their bubbles, in their color` },
        { key: "bubbleMyName", on: look.myName, label: "Your name", hint: `Your name ${look.tailMine === "bottom" ? "under" : "over"} your bubbles, in your ring color` },
        { key: "bubbleEdges", on: look.edges, label: "Edges in companion colors", hint: "A companion bubble's thin border in that companion's color" },
        { key: "bubbleQuietActions", on: look.quietActions, label: "Quieter action lines", hint: "Every action line a little softer than the words, yours too" },
        { key: "bubblePlainWords", on: theme.bubblePlainWords === true, label: "Plain white and black words", hint: "The chat's words without the theme's color in them" },
      ];
      const page = resolveThemeColors(colors).pageBg;
      const sampleColor = nameColor(SAMPLE_COMPANION.slug, SAMPLE_COMPANION.color, theme.mode, page);
      const themeName = nameColor("", resolveThemeColors(colors).accent, theme.mode, page);
      const sampleName = look.nameColors ? sampleColor : themeName;
      const ring = appSettings.userAvatarColor || "#f97316";
      const mine = look.nameColors ? nameColor("", ring, theme.mode, page) : themeName;
      const tailChip = (on: boolean) => cn(
        "flex items-center justify-center px-3 py-2 rounded-2xl border text-[11px] font-bold uppercase tracking-widest",
        on ? "border-transparent" : `${colors.panelBg} ${colors.panelBorder} ${colors.accentText}`,
      );
      const tailStyle = (on: boolean) => on ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' } : undefined;
      // The previews wear a time the way the chat does: under the
      // bubble at the far end from the face, sharing the line with the
      // name when the tail is at the bottom.
      // As the chat draws it: the time inside the bubble, the date under it.
      const sampleDate = new Date().toLocaleString(undefined, { month: "short", day: "numeric" });
      const sampleClock = new Date().toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
      const timeInside = <span className="block text-right text-[10px] font-bold leading-none mt-1 opacity-60">{sampleClock}</span>;
      const timePill = (who: "mine" | "ours", extra = "") => (
        <span className={cn("text-[10px] font-bold text-[var(--aerie-text)]", extra)}>
          <span className={cn("aerie-message-time", who === "mine" ? "aerie-theme-user-bubble" : "aerie-theme-comp-bubble")}>{sampleDate}</span>
        </span>
      );
      return (<>
    <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
      <h3 className={cn("micro-label", colors.accentText)}>
        Bubble Shape
      </h3>
      <div className="flex items-center gap-4 px-1">
        <span className={cn("text-[10px] font-bold uppercase tracking-wider", colors.textMuted)}>Sharp</span>
        <input
          type="range"
          min={0}
          max={24}
          step={2}
          value={theme.shapeRadius ?? themeRadiusPx(activeTheme.radius)}
          onChange={(e) => onThemeChange({ shapeRadius: Number(e.target.value) })}
          className="flex-1 cursor-pointer"
          style={{ accentColor: colors.accent }}
        />
        <span className={cn("text-[10px] font-bold uppercase tracking-wider", colors.textMuted)}>Round</span>
      </div>
      {/* Wears them real tail, point or swoop, the way the chat draws ours
          (theirs, Nov 9 2026: the preview should match what's set). */}
      <span className="relative block">
        {look.tailShape === "swoop" && (
          <BubbleSkin bubbleRef={shapePreviewRef} right={false} top={look.tailOurs === "top"} paintClass={colors.compBubbleBg} />
        )}
        <span
          ref={shapePreviewRef}
          className={cn("aerie-message-bubble block px-3.5 py-2.5 border text-[13px] font-medium", colors.compBubbleBg, colors.compBubbleText, colors.panelBorder, look.tailShape === "swoop" && SKINNED)}
          style={bubbleCorners('ours', look.tailOurs)}
        >
          Live preview — every bubble and card in the house follows this corner.
        </span>
      </span>
    </section>
        <section className={cn("space-y-3 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
          <h3 className={cn("micro-label", colors.accentText)}>Bubbles</h3>
          <div className="space-y-2">
            {SWITCHES.map((sw) => (
              <button
                key={sw.key}
                onClick={() => onThemeChange({ [sw.key]: !sw.on } as Partial<AppTheme>)}
                className={cn('flex w-full items-center justify-between gap-3 px-3 py-2.5 rounded-xl border text-left', colors.panelBorder, colors.textMain)}
                style={sw.on ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: colors.accent } : undefined}
                aria-pressed={sw.on}
              >
                <span className="flex flex-col">
                  <span className="text-xs font-bold">{sw.label}</span>
                  <span className="text-[10px] opacity-75">{sw.hint}</span>
                </span>
                <span className="text-[10px] font-bold tracking-widest">{sw.on ? "ON" : "OFF"}</span>
              </button>
            ))}
          </div>
          {/* Which corner each side's tail comes from. */}
          <div className="space-y-2 pt-1">
            {([["bubbleTailMine", "Your tail", look.tailMine], ["bubbleTailOurs", "Companion tails", look.tailOurs]] as ["bubbleTailMine" | "bubbleTailOurs", string, "top" | "bottom"][]).map(([key, label, at]) => (
              <div key={key} className="flex items-center gap-2">
                <span className={cn("w-20 shrink-0 text-[11px] font-bold", colors.textMain)}>{label}</span>
                {(["top", "bottom"] as const).map((pos) => (
                  <button key={pos} onClick={() => onThemeChange({ [key]: pos } as Partial<AppTheme>)} className={cn("flex-1", tailChip(at === pos))} style={tailStyle(at === pos)}>
                    {pos === "top" ? "Top" : "Bottom"}
                  </button>
                ))}
              </div>
            ))}
            {/* The tail's shape on both sides: the point, or a swoop curling out of that corner. */}
            <div className="flex items-center gap-2">
              <span className={cn("w-20 shrink-0 text-[11px] font-bold", colors.textMain)}>Tail shape</span>
              {(["point", "swoop"] as const).map((shape) => (
                <button key={shape} onClick={() => onThemeChange({ bubbleTailShape: shape })} className={cn("flex-1", tailChip(look.tailShape === shape))} style={tailStyle(look.tailShape === shape)}>
                  {shape === "point" ? "Point" : "Swoop"}
                </button>
              ))}
            </div>
            {/* The rings round the faces: as set in the house, or the theme's. */}
            <div className="flex items-center gap-2">
              <span className={cn("w-20 shrink-0 text-[11px] font-bold", colors.textMain)}>Rings</span>
              {(["house", "theme"] as const).map((pick) => (
                <button key={pick} onClick={() => onThemeChange({ bubbleRings: pick })} className={cn("flex-1", tailChip(look.rings === pick))} style={tailStyle(look.rings === pick)}>
                  {pick === "house" ? "House" : "Theme"}
                </button>
              ))}
            </div>
            {/* Names and typing dots the same way as the rings: House is the
                companions' own colors, Theme is the theme's ink. */}
            {([
              ["Names", "bubbleNameColors", look.nameColors],
              ["Dots", "bubbleDotColors", look.dotColors],
            ] as const).map(([label, key, on]) => (
              <div key={key} className="flex items-center gap-2">
                <span className={cn("w-20 shrink-0 text-[11px] font-bold", colors.textMain)}>{label}</span>
                {([true, false] as const).map((pick) => (
                  <button key={String(pick)} onClick={() => onThemeChange({ [key]: pick })} className={cn("flex-1", tailChip(on === pick))} style={tailStyle(on === pick)}>
                    {pick ? "House" : "Theme"}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {/* A sample companion bubble, drawn by the same rules the chat uses. */}
          {/* Faces pinned to the bubble's own edge, as the chat does. */}
          <div className="flex gap-2 pt-1" aria-hidden="true">
            {look.faces && <span className="w-9 shrink-0" />}
            <span className="flex min-w-0 flex-col items-start">
              {look.names && look.tailOurs === "top" && (
                <span className="mb-1 ml-0.5 text-[10px] font-semibold uppercase" style={{ letterSpacing: "0.16em", color: sampleName }}>{SAMPLE_COMPANION.name}</span>
              )}
              {/* Never narrower than the line under it, as the chat draws it. */}
              <span className="relative self-stretch">
                {look.faces && (
                  <span
                    className={cn("absolute -left-[44px] h-9 w-9 rounded-full border-2 flex items-center justify-center text-sm", look.tailOurs === "bottom" ? "bottom-0" : "top-0.5", look.rings === "theme" && "aerie-theme-ring")}
                    style={look.rings === "theme" ? undefined : { borderColor: SAMPLE_COMPANION.color, background: "rgba(127,127,127,0.15)" }}
                  >{SAMPLE_COMPANION.name.charAt(0)}</span>
                )}
                {look.tailShape === "swoop" && (
                  <BubbleSkin bubbleRef={oursPreviewRef} right={false} top={look.tailOurs === "top"} paintClass={colors.compBubbleBg} />
                )}
                <span
                  ref={oursPreviewRef}
                  className={cn("aerie-message-bubble block px-3.5 py-2.5 border text-[13px]", colors.compBubbleBg, colors.compBubbleText, colors.panelBorder, look.tailShape === "swoop" && SKINNED)}
                  style={{ ...bubbleCorners("ours", look.tailOurs), ...(look.edges ? { borderColor: `color-mix(in srgb, ${sampleColor} 45%, transparent)` } : {}) }}
                  data-quiet-actions={look.quietActions ? "true" : undefined}
                >
                  <em>waves</em>
                  <br />
                  This is how a reply will look.
                  {timeInside}
                </span>
              </span>
              <span className="mt-1 flex w-full items-center justify-between gap-3">
                {look.names && look.tailOurs === "bottom"
                  ? <span className="min-w-0 break-words ml-0.5 text-[10px] font-semibold uppercase" style={{ letterSpacing: "0.16em", color: sampleName }}>{SAMPLE_COMPANION.name}</span>
                  : <span />}
                {timePill("ours", "shrink-0")}
              </span>
            </span>
          </div>
          {/* And one of their person's, on the right. */}
          <div className="flex justify-end gap-2" aria-hidden="true">
            <span className="flex min-w-0 flex-col items-end">
              {look.myName && look.tailMine === "top" && (
                <span className="mb-1 mr-0.5 text-right break-words text-[10px] font-semibold uppercase" style={{ letterSpacing: "0.16em", color: mine }}>{ownerName}</span>
              )}
              <span className="relative self-stretch">
                {look.faces && (() => {
                  const themed = look.rings === "theme";
                  const pin = cn("absolute -right-[44px] h-9 w-9 rounded-full border-2", look.tailMine === "bottom" ? "bottom-0" : "top-0.5", themed && "aerie-theme-ring");
                  return appSettings.userAvatar
                    ? <img src={appSettings.userAvatar} alt="" className={cn(pin, "object-cover")} style={themed ? undefined : { borderColor: ring }} />
                    : <span className={pin} style={themed ? undefined : { borderColor: ring, background: "rgba(127,127,127,0.15)" }} />;
                })()}
                {look.tailShape === "swoop" && (
                  <BubbleSkin bubbleRef={minePreviewRef} right top={look.tailMine === "top"} paintClass={colors.userBubbleBg} />
                )}
                <span
                  ref={minePreviewRef}
                  className={cn("aerie-message-bubble block px-3.5 py-2.5 border text-[13px]", colors.userBubbleBg, colors.userBubbleText, colors.panelBorder, look.tailShape === "swoop" && SKINNED)}
                  style={bubbleCorners("mine", look.tailMine)}
                >
                  And this is me.
                  {timeInside}
                </span>
              </span>
              <span className="mt-1 flex w-full flex-row-reverse items-center justify-between gap-3">
                {look.myName && look.tailMine === "bottom"
                  ? <span className="min-w-0 break-words text-right mr-0.5 text-[10px] font-semibold uppercase" style={{ letterSpacing: "0.16em", color: mine }}>{ownerName}</span>
                  : <span />}
                {timePill("mine", "shrink-0")}
              </span>
            </span>
            {look.faces && <span className="w-9 shrink-0" />}
          </div>
        </section>
        {/* How many apps sit in a row of the drawer;
            each row size keeps its own arrangement (lib/apps.ts). */}
        <section className={cn("space-y-3 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
          <h3 className={cn("micro-label", colors.accentText)}>App Drawer</h3>
          <div className="flex items-center gap-2">
            <span className={cn("w-20 shrink-0 text-[11px] font-bold", colors.textMain)}>In a row</span>
            {([4, 5] as const).map((n) => (
              <button key={n} onClick={() => onThemeChange({ drawerColumns: n })} className={cn("flex-1", tailChip(drawerColumnsOf(theme.drawerColumns) === n))} style={tailStyle(drawerColumnsOf(theme.drawerColumns) === n)}>
                {n}
              </button>
            ))}
          </div>
          <p className={cn("text-[10px]", colors.textMuted)}>Each row size keeps its own arrangement, so moving apps at one never moves them at the other.</p>
          {/* The rest of the drawer's look (lib/drawer-look.ts),
              every row starting as the drawer looks today. */}
          {(() => {
            const dl = drawerLookOf(theme);
            const ROWS: { label: string; key: "drawerIconSize" | "drawerIconShape" | "drawerLabels" | "drawerIconColor" | "drawerTiles"; now: unknown; picks: { value: unknown; text: string }[] }[] = [
              { label: "Icon size", key: "drawerIconSize", now: dl.size, picks: [{ value: "small", text: "Small" }, { value: "medium", text: "Medium" }, { value: "large", text: "Large" }] },
              { label: "Shape", key: "drawerIconShape", now: dl.shape, picks: [{ value: "rounded", text: "Rounded" }, { value: "circle", text: "Circle" }, { value: "square", text: "Square" }] },
              { label: "Names", key: "drawerLabels", now: dl.labels, picks: [{ value: "card", text: "Card" }, { value: "plain", text: "Plain" }, { value: "hidden", text: "Off" }] },
              { label: "Icon color", key: "drawerIconColor", now: dl.iconColor, picks: [{ value: "theme", text: "Theme" }, { value: "accent", text: "Accent" }] },
              { label: "Tiles", key: "drawerTiles", now: dl.tiles, picks: [{ value: true, text: "On" }, { value: false, text: "Off" }] },
            ];
            const sample = APPS.slice(0, 4);
            const tile = drawerTileStyle(dl) as React.CSSProperties;
            const iconPx = drawerIconPx(dl);
            return (<>
              {ROWS.map((row) => (
                <div key={row.key} className="flex items-center gap-2">
                  <span className={cn("w-20 shrink-0 text-[11px] font-bold", colors.textMain)}>{row.label}</span>
                  {row.picks.map((pick) => (
                    // Three words in a row of capitals ran past the card at
                    // the widest spacing (SQUARE), so these chips may shrink
                    // and space their letters less.
                    <button key={String(pick.value)} onClick={() => onThemeChange({ [row.key]: pick.value } as Partial<AppTheme>)} className={cn("flex-1 min-w-0", tailChip(row.now === pick.value), "px-1.5 tracking-wide")} style={tailStyle(row.now === pick.value)}>
                      {pick.text}
                    </button>
                  ))}
                </div>
              ))}
              {/* Four tiles drawn by the same rules the drawer uses, each as wide as
                  a drawer column, and centered in the row. */}
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-3 pt-2" aria-hidden="true">
                {sample.map((app) => (
                  <div key={app.id} className="flex flex-col items-center gap-1.5" style={{ width: `calc((100% - ${drawerColumnsOf(theme.drawerColumns) - 1} * 0.75rem) / ${drawerColumnsOf(theme.drawerColumns)})` }}>
                    <div className="aerie-app-tile flex items-center justify-center" style={tile}>
                      <app.icon style={{ width: iconPx, height: iconPx }} />
                    </div>
                    {dl.labels !== "hidden" && <AppLabel className={colors.textMain} plain={dl.labels === "plain"}>{app.name}</AppLabel>}
                  </div>
                ))}
              </div>
            </>);
          })()}
        </section>
      </>);
    })()}
    {/* Fonts (lib/fonts.ts): a title font, a message font and a size,
        each starting where the phone already was. */}
    {(() => {
      const hf = fontsOf(appSettings, activeTheme.fontFamily);
      const chip = (on: boolean) => cn(
        "flex min-w-0 flex-col items-center justify-center gap-0.5 px-2 py-2.5 rounded-2xl border transition-all duration-300",
        on ? "border-transparent" : `${colors.panelBg} ${colors.panelBorder} ${colors.textMain}`,
      );
      const chipStyle = (on: boolean, stack: string): React.CSSProperties => ({
        fontFamily: stack,
        ...(on ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' } : {}),
      });
      return (
        <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
          <h3 className={cn("micro-label", colors.accentText)}>Fonts</h3>
          <div className="space-y-2">
            <span className={cn("text-[11px] font-bold", colors.textMain)}>Titles</span>
            <div className="grid grid-cols-2 gap-2">
              {TITLE_FONTS.map((f) => (
                <button key={f.id} onClick={() => onSettingsChange({ fontTitle: f.id })} className={chip(hf.title === f.id)} style={chipStyle(hf.title === f.id, f.stack)}>
                  <span className="text-lg italic leading-tight">Aa</span>
                  <span className="text-[11px] leading-tight text-center">{f.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className={cn("text-[11px] font-bold", colors.textMain)}>Title size</span>
              <span className={cn("text-[11px] font-bold", colors.textMuted)}>{Math.round(hf.titleScale * 100)}%</span>
            </div>
            <div className="flex items-center gap-3 px-1">
              <span className={cn("text-[11px] font-bold", colors.textMuted)} style={{ fontFamily: titleStack(hf.title) }}>A</span>
              <input
                type="range"
                min={TITLE_SCALE_MIN}
                max={TITLE_SCALE_MAX}
                step={0.05}
                value={hf.titleScale}
                onChange={(e) => onSettingsChange({ fontTitleScale: Number(e.target.value) })}
                className="flex-1 cursor-pointer"
                style={{ accentColor: colors.accent }}
              />
              <span className={cn("text-lg font-bold", colors.textMuted)} style={{ fontFamily: titleStack(hf.title) }}>A</span>
            </div>
          </div>
          <div className="space-y-2">
            <span className={cn("text-[11px] font-bold", colors.textMain)}>Messages</span>
            <div className="grid grid-cols-3 gap-2">
              {BODY_FONTS.map((f) => (
                <button key={f.id} onClick={() => onSettingsChange({ fontBody: f.id })} className={chip(hf.body === f.id)} style={chipStyle(hf.body === f.id, f.stack)}>
                  <span className="text-base leading-tight">Aa</span>
                  <span className="text-[10px] leading-tight text-center">{f.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className={cn("text-[11px] font-bold", colors.textMain)}>Text size</span>
              <span className={cn("text-[11px] font-bold", colors.textMuted)}>{Math.round(hf.scale * 100)}%</span>
            </div>
            <div className="flex items-center gap-3 px-1">
              <span className={cn("text-[11px] font-bold", colors.textMuted)}>A</span>
              <input
                type="range"
                min={FONT_SCALE_MIN}
                max={FONT_SCALE_MAX}
                step={0.025}
                value={hf.scale}
                onChange={(e) => onSettingsChange({ fontScale: Number(e.target.value) })}
                className="flex-1 cursor-pointer"
                style={{ accentColor: colors.accent }}
              />
              <span className={cn("text-base font-bold", colors.textMuted)}>A</span>
            </div>
          </div>
          {/* A title and a line of a message, in what has been picked. */}
          <div className={cn("rounded-xl border px-3 py-2.5 space-y-1", colors.panelBorder)} aria-hidden="true">
            <div className={cn("text-base italic", colors.textMain)} style={{ fontFamily: titleStack(hf.title), zoom: hf.titleScale }}>Messages</div>
            {/* In rem, like the real messages, so the Size slider moves this preview too, not only the title. */}
            <div className={cn("text-[0.9375rem]", colors.textMain)} style={{ fontFamily: bodyStack(hf.body) }}>Morning. The kettle's on.</div>
          </div>
        </section>
      );
    })()}

    {/* Send button icon */}
    <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
      <h3 className={cn("micro-label", colors.accentText)}>
        Send Button
      </h3>
      <div className="space-y-3">
        <p
          className={cn(
            "text-[10px] leading-relaxed",
            colors.textMuted,
          )}
        >
          Choose the icon that sits on the send button in your chat composer.
        </p>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {SEND_ICONS.map(({ id, label, icon: Icon }) => {
            const isActive =
              (appSettings.sendIconId ?? DEFAULT_SEND_ICON_ID) === id;
            return (
              <button
                key={id}
                onClick={() => onSettingsChange({ sendIconId: id })}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 p-2.5 rounded-2xl border transition-all duration-300",
                  isActive
                    ? "border-transparent"
                    : cn(colors.panelBg, colors.panelBorder, "opacity-70 hover:opacity-100"),
                )}
                style={
                  isActive
                    ? {
                        background: 'var(--aerie-selected-fill)',
                        borderColor: colors.accent,
                        color: 'var(--aerie-on-accent)',
                      }
                    : undefined
                }
                title={label}
              >
                <Icon size={18} strokeWidth={2} />
                <span className="text-[8px] uppercase tracking-wider font-bold truncate w-full text-center">
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>

    {/* The five at the top of the React tray. */}
    <QuickReactionsSetting
      colors={colors}
      value={appSettings.quickReactions}
      customEmojis={appSettings.customEmojis}
      emojiPacks={emojiPacks}
      onChange={(next) => onSettingsChange({ quickReactions: next })}
    />

    </>
  );
}
