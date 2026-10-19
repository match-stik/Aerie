// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useBackHandler } from '../lib/use-back-handler';
import {
  X,
  Moon,
  Sun,
  Palette,
  Image as ImageIcon,
  Upload,
  Check,
  Smartphone,
  Bell,
  Plus,
  Minus,
  Settings as SettingsIcon,
  Loader2,
  ExternalLink,
  LogOut,
  UserRound,
  Trash2,
  Shapes,
  Home,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { AppShell } from "./AppShell";
import Cropper from "react-easy-crop";
import { PushNotifications } from "@capacitor/push-notifications";
import { Capacitor } from "@capacitor/core";
import { AppTheme, ThemeId, ThemeMode, AppSettings } from "../types";
import { PALETTE_THEME_IDS, THEMES, resolveThemeColors, themeRadiusPx } from "../lib/theme";
import { APPS, drawerColumnsOf, migrateAppIds, useAppName } from "../lib/apps";
import { noteColorsForAccent, noteColorsForPalette } from '../lib/note-colors';
import { cn } from "../lib/utils";
import getCroppedImg from "../lib/cropImage";
import { WebUiPassword } from "./WebUiPassword";
import { SetupSync } from "./SetupSync";
import { AppUpdate } from "./AppUpdate";
import { SEND_ICONS, DEFAULT_SEND_ICON_ID } from "../lib/sendIcons";
import { Toggle } from "./Toggle";
import { LockPreview } from "./LockClock";
import { HOME_WIDGETS, homeWidgetsOf, toggleWidget } from "../lib/home-widgets";
import { bubbleCorners, bubbleLookOf, nameColor } from "../lib/bubble-look";
import { BubbleSkin, SKINNED } from "./BubbleSkin";
import { drawerIconPx, drawerLookOf, drawerTileStyle } from "../lib/drawer-look";
import { BODY_FONTS, FONT_SCALE_MAX, FONT_SCALE_MIN, TITLE_FONTS, TITLE_SCALE_MAX, TITLE_SCALE_MIN, bodyStack, fontsOf, titleStack } from "../lib/fonts";
import { AppLabel } from "./AppLabel";
import { lockClockAtOf, lockFaceOf, lockHiddenOf, lockPositionOf, lockShortcutsOf, lockShowOf, lockSizeOf, lockWeatherAtOf, withClockAt, withHidden, type LockFace, type LockPiece, type LockShow, type LockSize } from "../lib/lock-clock";
import { apiFetch, houseKeepsLinkedFiles, storeInlinePicture } from "../aerie";

// A stand-in companion for the bubble preview: a neutral name and color, not
// any real companion in the house.
const SAMPLE_COMPANION = { slug: "cedar", name: "Cedar", color: "#0d9488" };

// Determine if a hex color is near-white (needs black foreground for contrast)
// Only returns true for very light colors like mono's #FAFAFA — most accent colors get white text
function isNearWhite(hex: string): boolean {
  // Handle CSS variables or non-hex strings — can't compute, use white text
  if (!hex || !hex.startsWith('#') || hex.length < 7) return false;
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  // Handle parse failures
  if (isNaN(r) || isNaN(g) || isNaN(b)) return false;
  // Only trigger for very light colors (luminance > 0.85)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.85;
}

interface SettingsDashboardProps {
  theme: AppTheme;
  appSettings: Omit<AppSettings, "theme" | "contacts">;
  onThemeChange: (theme: Partial<AppTheme>) => void;
  onSettingsChange: (
    settings: Partial<Omit<AppSettings, "theme" | "contacts">>,
  ) => void;
  onClose: () => void;
  /** The owner's name, for the bubble preview's label. */
  ownerName?: string;
}

export const SettingsDashboard: React.FC<SettingsDashboardProps> = ({
  theme,
  appSettings,
  onThemeChange,
  onSettingsChange,
  onClose,
  ownerName = "You",
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  // The Bubbles preview's two bubbles, for the swoop drawn beside them.
  const oursPreviewRef = useRef<HTMLSpanElement>(null);
  const minePreviewRef = useRef<HTMLSpanElement>(null);
  const activeTheme = THEMES[theme.id] || THEMES["monochrome"];
  const colors = activeTheme[theme.mode];

  // These five used to be five pale hex values written into this file, saved on
  // the user's theme, and handed to the Notes app as the only source -- so the notes
  // were pale whatever theme was on, and one app-wide font colour melted the
  // writing into them. They come out of the theme's own accent now, and this
  // setting is an OVERRIDE rather than the source. Clearing it goes back to
  // whatever the theme says.
  const themeNoteColors = React.useMemo(() => {
    // On the Custom theme the accent is a CSS variable rather than a value, so
    // it has to come from the user's own picks instead -- otherwise Custom silently
    // falls back to the pale five and looks like nothing happened.
    const raw = theme.id === 'custom'
      ? theme.customColors?.[theme.mode]?.accent
      : colors.accent;
    const accent = typeof raw === 'string' ? raw.trim() : '';
    const pal = THEMES[theme.id]?.palette;
    const generated = pal
      ? noteColorsForPalette(theme.mode === 'dark' ? pal.night : pal.day, theme.mode)
      : accent.startsWith('#') ? noteColorsForAccent(accent, theme.mode) : [];
    return generated.length ? generated : ['#fef08a', '#bfdbfe', '#bbf7d0', '#fbcfe8', '#e9d5ff'];
  }, [colors.accent, theme.mode, theme.id, theme.customColors]);
  const shownNoteColors = theme.stickyNoteColors && theme.stickyNoteColors.length
    ? theme.stickyNoteColors
    : themeNoteColors;
  // Resolve the actual hex accent color (custom uses CSS vars, need actual value)
  const resolvedAccent = theme.id === "custom"
    ? (theme.customColors?.[theme.mode]?.accent || "#888888")
    : colors.accent;
  const [activeTab, setActiveTab] = useState<"appearance" | "data">("appearance");
  // Personalize: four doors instead of one long scroll. null is the tile page.
  const [pane, setPane] = useState<null | "theme" | "look" | "home" | "you" | "lock">(null);
  // Which lock screen corner the shortcut picker is setting: 0 left, 1 right.
  const [lockCorner, setLockCorner] = useState<0 | 1>(0);
  // The dock picker names a room the way the drawer does, so an app a house
  // has renamed shows its house name.
  const nameOf = useAppName();

  // Cropper state
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<
    "single" | "lockscreen" | "avatar" | number
  >("single");
  // The back gesture inside a door goes to the doors, like the card at the top,
  // rather than out to the home screen, and from the doors it closes Settings.
  // Settings answers every back press while it is open, so App asks it first.
  useBackHandler(true, () => {
    if (cropImageSrc) setCropImageSrc(null);
    else if (pane !== null) setPane(null);
    else onClose();
  });
  const [isSaving, setIsSaving] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);

  const handlePushToggle = async () => {
    const isEnabling = !appSettings.pushNotificationsEnabled;

    if (isEnabling) {
      if (Capacitor.isNativePlatform()) {
        try {
          let permStatus = await PushNotifications.checkPermissions();

          if (permStatus.receive !== "granted") {
            permStatus = await PushNotifications.requestPermissions();
          }

          if (permStatus.receive === "granted") {
            // LISTENERS FIRST, THEN register(). On a device that already holds a
            // cached token the "registration" event fires immediately — before
            // anything is listening if register() goes first — and the token is
            // never sent, so enabling push silently does nothing and there is no
            // error anywhere to find. Reported by Rose and Sol on a fresh install.
            await PushNotifications.addListener("registration", async (token) => {
              console.log("[Aerie] FCM token generated");

              // The house holds the Firebase credentials and does the sending,
              // so the token is registered here rather than with the old
              // Cloudflare worker the Constellation Phone used.
              try {
                await fetch("/api/push/subscribe", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({
                    deviceToken: token.value,
                    deviceLabel: Capacitor.getPlatform(),
                  }),
                });
              } catch (e) {
                console.error("[Aerie] Failed to register push token:", e);
              }
            });

            await PushNotifications.addListener("registrationError", (error) => {
              console.error("Push Registration Error: " + error.error);
            });

            // Both listeners are attached; now ask for the token.
            await PushNotifications.register();
          } else {
            console.warn(
              "Push Notification permissions denied by user.",
            );
            return; // They denied, don't enable it internally
          }
        } catch (err: any) {
          if (err?.message?.includes('FirebaseApp is not initialized')) {
            console.error('Push Setup Failed: Missing google-services.json file for Android. Please check the Developer console documentation on initializing FirebaseApp for Capacitor Push Notifications.');
          } else {
            console.error("Push Setup Failed: " + (err?.message || String(err)));
          }
          return;
        }
      } else {
        // Non-native (web) path is intentionally a no-op. The PWA web-push
        // transport was pulled because the service worker was firing
        // notification events the rest of the app misread as live
        // activity. Push lights up when you ship the APK.
        alert("Push notifications only work in the Android/iOS app.");
        return;
      }
    }
    // Disabling is a setting-flag flip — no transport-specific teardown.
    // Capacitor manages its own registration lifecycle; the no-op web path
    // has nothing to undo.

    onSettingsChange({ pushNotificationsEnabled: isEnabling });
  };

  // Center-crop to a square and downscale so the avatar stays a few KB in
  // the synced settings blob instead of a full camera-roll image.
  const downscaleAvatar = (dataUrl: string, size = 192): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const s = Math.min(img.width, img.height);
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });

  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: "single" | "lockscreen" | "avatar" | number,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCropTarget(target);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      if (result && result.startsWith("data:image/")) {
        setCropImageSrc(result);
      }
    };
    // Reset input
    e.target.value = "";
  };

  const onCropComplete = useCallback(
    (croppedArea: any, croppedAreaPixels: any) => {
      setCroppedAreaPixels(croppedAreaPixels);
    },
    [],
  );

  // A wallpaper goes into the house's file store and the settings keep only
  // its link, so the settings stay light (lib/wallpaper-files.ts). If the
  // house cannot take it, or has not said it keeps linked files, the picture
  // stays inline exactly as before. The avatar is small and stays inline.
  const storedPicture = async (imageUrl: string) => {
    if (cropTarget === "avatar" || !houseKeepsLinkedFiles()) return imageUrl;
    return (await storeInlinePicture(imageUrl)) ?? imageUrl;
  };

  const handleSaveCrop = async () => {
    if (!cropImageSrc || !croppedAreaPixels || isSaving) return;
    setIsSaving(true);
    try {
      const croppedImage = await getCroppedImg(
        cropImageSrc,
        croppedAreaPixels,
        0,
        { horizontal: false, vertical: false },
        2048,
      );
      saveImageResult(await storedPicture(croppedImage));
      setCropImageSrc(null);
    } catch (e) {
      console.error("Failed to crop image:", e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUseOriginal = async () => {
    if (!cropImageSrc || isSaving) return;
    setIsSaving(true);
    try {
      saveImageResult(await storedPicture(cropImageSrc));
      setCropImageSrc(null);
    } finally {
      setIsSaving(false);
    }
  };

  const saveImageResult = (imageUrl: string) => {
    if (cropTarget === "avatar") {
      // Downscale after the crop so the synced settings blob stays light.
      downscaleAvatar(imageUrl)
        .then((a) => onSettingsChange({ userAvatar: a }))
        .catch(() => onSettingsChange({ userAvatar: imageUrl }));
    } else if (cropTarget === "single") {
      onThemeChange({ wallpaper: imageUrl });
    } else if (cropTarget === "lockscreen") {
      onThemeChange({ lockScreenWallpaper: imageUrl });
    } else {
      const currentWallpapers = [...(theme.wallpapers || [])];
      currentWallpapers[cropTarget as number] = imageUrl;
      onThemeChange({ wallpapers: currentWallpapers.filter(Boolean) });
    }
  };

  const removeSlideshowImage = (index: number) => {
    const currentWallpapers = [...(theme.wallpapers || [])];
    currentWallpapers.splice(index, 1);
    onThemeChange({ wallpapers: currentWallpapers });
  };

  const handleColorSelect = (themeId: ThemeId) => {
    if (themeId === "custom" && !theme.customColors) {
      onThemeChange({
        id: themeId,
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
    } else {
      onThemeChange({ id: themeId });
    }
  };

  const isColorSelected = (themeId: ThemeId) => {
    return theme.id === themeId;
  };

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
        <div className={cn("p-3 rounded-2xl border mb-4 flex justify-center", colors.panelBg, colors.panelBorder)}>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
          {(["appearance", "data"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setPane(null); }}
              className={cn(
                "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border capitalize",
                colors.panelBorder,
                activeTab !== tab && cn(colors.panelBg, colors.textMain),
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
              {pane === 'theme' && (<>
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

              </>)}
              {pane === 'lock' && (() => {
                const face = lockFaceOf(theme.lockFace);
                const position = lockPositionOf(theme.lockClockPosition);
                const size = lockSizeOf(theme.lockClockSize);
                const wallpaper = theme.lockScreenWallpaper || theme.wallpaper;
                // Set once this face's clock, or the weather, has been dragged
                // somewhere by hand.
                const movedAt = lockClockAtOf(theme.lockClockAt, face);
                const weatherMoved = lockWeatherAtOf(theme.lockWeatherAt);
                // What has been tucked away; its chip brings it back.
                const hidden = lockHiddenOf(theme.lockHidden);
                const chip = (on: boolean) => cn(
                  "flex items-center justify-center px-3 py-2.5 rounded-2xl border text-[11px] font-bold uppercase tracking-widest transition-all duration-300",
                  on ? "border-transparent" : `${colors.panelBg} ${colors.panelBorder} ${colors.accentText} hover:opacity-80`,
                );
                const chipStyle = (on: boolean) => on ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' } : undefined;
                const FACES: { id: LockFace; label: string; hint: string }[] = [
                  { id: "stacked", label: "Stacked", hint: "Hour over minute, big" },
                  { id: "dateline", label: "Dateline", hint: "Your picture up top, time along the bottom" },
                  { id: "classic", label: "Classic", hint: "Today's clock, moved and sized your way" },
                ];
                return (<>
                  <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
                    <h3 className={cn("micro-label", colors.accentText)}>Wallpaper</h3>
                    {/* Its own picture, which falls back to the home wallpaper when unset. */}
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
                            onChange={(e) => handleImageUpload(e, "lockscreen")}
                            className="hidden"
                            accept="image/*"
                          />
                        </label>
                        {theme.lockScreenWallpaper ? (
                          <>
                            <img
                              src={theme.lockScreenWallpaper}
                              className="w-full h-full object-cover opacity-60"
                              alt="Lock Screen Wallpaper"
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
                          Lock Screen Background
                        </p>
                        {theme.lockScreenWallpaper && (
                          <button
                            onClick={() =>
                              onThemeChange({ lockScreenWallpaper: undefined })
                            }
                            className="text-[10px] font-bold uppercase tracking-widest transition-colors opacity-80 hover:opacity-100"
                            style={{ color: colors.accent }}
                          >
                            Reset Lock Screen
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                  <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
                    <h3 className={cn("micro-label", colors.accentText)}>Clock face</h3>
                    <div className="grid grid-cols-3 gap-3">
                      {FACES.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => onThemeChange({ lockFace: f.id })}
                          className="flex flex-col items-center gap-2 text-center"
                          aria-pressed={face === f.id}
                        >
                          <span
                            className="rounded-[18px] p-[3px]"
                            style={{ background: face === f.id ? 'var(--aerie-selected-fill)' : 'transparent' }}
                          >
                            <LockPreview face={f.id} position={position} size={size} wallpaper={wallpaper} width={88} at={lockClockAtOf(theme.lockClockAt, f.id)} />
                          </span>
                          <span className={chip(face === f.id)} style={chipStyle(face === f.id)}>{f.label}</span>
                          <span className={cn("text-[10px] leading-snug", colors.textMuted)}>{f.hint}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                  {/* Holding the clock or the weather on the lock screen moves it,
                      so the old Top / Middle / Low row is gone and every face
                      takes a size instead. Each face keeps its own spot. */}
                  <section className={cn("space-y-3 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
                    <h3 className={cn("micro-label", colors.accentText)}>Size</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {([["s", "Small"], ["m", "Medium"], ["l", "Large"]] as [LockSize, string][]).map(([id, label]) => (
                        <button key={id} onClick={() => onThemeChange({ lockClockSize: id })} className={chip(size === id)} style={chipStyle(size === id)}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <h3 className={cn("micro-label pt-1", colors.accentText)}>On the lock screen</h3>
                    <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
                      Hold the clock or the weather until it lifts, drag it anywhere, and let go. Drag it up to the top to hide it, and tap it here to show it again. Each face remembers where its clock sits; Clock home and Weather home send them back to where they started.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {([["clock", "Clock"], ["weather", "Weather"]] as [LockPiece, string][]).map(([piece, label]) => {
                        const on = !hidden.has(piece);
                        return (
                          <button
                            key={piece}
                            onClick={() => onThemeChange({ lockHidden: withHidden(theme.lockHidden, piece, on) })}
                            className={chip(on)}
                            style={chipStyle(on)}
                            aria-pressed={on}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    {(movedAt || weatherMoved) && (
                      <div className="grid grid-cols-2 gap-2">
                        {movedAt && (
                          <button onClick={() => onThemeChange({ lockClockAt: withClockAt(theme.lockClockAt, face, null) })} className={chip(false)}>
                            Clock home
                          </button>
                        )}
                        {weatherMoved && (
                          <button onClick={() => onThemeChange({ lockWeatherAt: undefined })} className={chip(false)}>
                            Weather home
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                  {(() => {
                    const corners = lockShortcutsOf(theme.lockShortcuts);
                    const current = corners[lockCorner];
                    const setCorner = (id: string | null) => {
                      const next: [string | null, string | null] = [corners[0], corners[1]];
                      next[lockCorner] = id;
                      onThemeChange({ lockShortcuts: next });
                    };
                    return (
                      <section className={cn("space-y-3 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
                        <h3 className={cn("micro-label", colors.accentText)}>Shortcuts</h3>
                        <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
                          Two circles in the bottom corners of the lock screen. Each one opens its app straight away.
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {([[0, "Left corner"], [1, "Right corner"]] as [0 | 1, string][]).map(([c, label]) => (
                            <button key={label} onClick={() => setLockCorner(c)} className={chip(lockCorner === c)} style={chipStyle(lockCorner === c)}>
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setCorner(null)}
                            className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border text-xs text-left', colors.panelBorder, colors.textMain)}
                            style={current === null ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: colors.accent } : undefined}
                          >
                            <span className="flex-1 truncate">Nothing there</span>
                          </button>
                          {[...APPS].filter((a) => a.id !== 'settings').sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((app) => (
                            <button
                              key={`lock-corner-${app.id}`}
                              onClick={() => setCorner(app.id)}
                              className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border text-xs text-left', colors.panelBorder, colors.textMain)}
                              style={current === app.id ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: colors.accent } : undefined}
                            >
                              <app.icon size={14} />
                              <span className="flex-1 truncate">{nameOf(app)}</span>
                            </button>
                          ))}
                        </div>
                      </section>
                    );
                  })()}
                  <section className={cn("space-y-3 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
                    <h3 className={cn("micro-label", colors.accentText)}>Who's written you</h3>
                    <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
                      A card on the lock screen when there's something new. Names keeps the words off it, for when your phone is face up at work.
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {([["names", "Names"], ["first-line", "First line"], ["nothing", "Nothing"]] as [LockShow, string][]).map(([id, label]) => (
                        <button key={id} onClick={() => onThemeChange({ lockShow: id })} className={chip(lockShowOf(theme.lockShow) === id)} style={chipStyle(lockShowOf(theme.lockShow) === id)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </section>
                </>);
              })()}
              {pane === 'you' && (<>
              {/* Your Avatar — the owner's bubble face + ring color, the
                  user-side counterpart of the companion voice avatars */}
              <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
                <h3 className={cn("micro-label", colors.accentText)}>
                  Your Avatar
                </h3>
                <div className="flex items-center gap-4">
                  <div
                    className="w-14 h-14 rounded-full overflow-hidden border-2 flex items-center justify-center shrink-0"
                    style={{
                      borderColor: appSettings.userAvatarColor || "transparent",
                      background: "rgba(127,127,127,0.15)",
                    }}
                  >
                    {appSettings.userAvatar ? (
                      <img src={appSettings.userAvatar} alt="Your avatar" className="w-full h-full object-cover" />
                    ) : (
                      <UserRound size={24} className="opacity-50" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => avatarInputRef.current?.click()}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold uppercase tracking-widest",
                          colors.panelBg, colors.panelBorder, colors.accentText, "hover:opacity-80",
                        )}
                      >
                        <Upload size={12} strokeWidth={2} />
                        Upload
                      </button>
                      {appSettings.userAvatar && (
                        <button
                          onClick={() => onSettingsChange({ userAvatar: undefined })}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold uppercase tracking-widest opacity-70",
                            colors.panelBg, colors.panelBorder, colors.textMain, "hover:opacity-100",
                          )}
                        >
                          <Trash2 size={12} strokeWidth={2} />
                          Remove
                        </button>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest cursor-pointer">
                      <span className={cn(colors.textMuted)}>Ring color</span>
                      <input
                        type="color"
                        value={appSettings.userAvatarColor || "#f97316"}
                        onChange={(e) => onSettingsChange({ userAvatarColor: e.target.value })}
                        className="h-6 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                      />
                    </label>
                  </div>
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleImageUpload(e, "avatar")}
                />
              </section>

              </>)}
              {pane === 'theme' && (<>
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

              </>)}
              {pane === 'theme' && (<>
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

              </>)}
              {pane === 'theme' && (<>
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

              </>)}
              {pane === 'look' && (() => {
                // The shape slider, which rounds the whole phone, and under it the
                // Bubbles switches (lib/bubble-look.ts), each starting as the
                // bubbles look today, with a preview drawn by the same rules the
                // chat uses. The slider changes everything, so they live here.
                const look = bubbleLookOf(theme);
                const SWITCHES: { key: "bubbleFaces" | "bubbleNames" | "bubbleMyName" | "bubbleEdges" | "bubbleQuietActions"; on: boolean; label: string; hint: string }[] = [
                  { key: "bubbleFaces", on: look.faces, label: "Faces", hint: "Companion faces beside their bubbles, and yours beside yours" },
                  { key: "bubbleNames", on: look.names, label: "Names", hint: `Each companion named ${look.tailOurs === "bottom" ? "under" : "over"} their bubbles, in their color` },
                  { key: "bubbleMyName", on: look.myName, label: "Your name", hint: `Your name ${look.tailMine === "bottom" ? "under" : "over"} your bubbles, in your ring color` },
                  { key: "bubbleEdges", on: look.edges, label: "Edges in companion colors", hint: "A companion bubble's thin border in that companion's color" },
                  { key: "bubbleQuietActions", on: look.quietActions, label: "Quieter action lines", hint: "Every action line a little softer than the words, the owner's too" },
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
                  <span className={cn("text-[10px] font-bold", theme.mode === "light" ? "text-black" : "text-white", extra)}>
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
                <div
                  className={cn("px-3.5 py-2.5 border text-[13px] font-medium", colors.compBubbleBg, colors.compBubbleText, colors.panelBorder)}
                  style={bubbleCorners('ours', look.tailOurs)}
                >
                  Live preview — every bubble in the house follows this corner.
                </div>
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
                    {/* And one of the owner's, on the right. */}
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
              {pane === 'you' && (<>
              {/* App Identity */}
              <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
                <h3 className={cn("micro-label", colors.accentText)}>
                  App Identity
                </h3>
                <div className="flex flex-col gap-6">
                  <div className="flex items-center gap-4 sm:gap-6">
                    <div
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-[calc(20px*var(--shape-scale,1))] sm:rounded-[calc(24px*var(--shape-scale,1))] flex items-center justify-center transition-all duration-500 shrink-0"
                      style={{ backgroundColor: colors.accent }}
                    >
                      <Smartphone
                        className="aerie-on-accent w-8 h-8 sm:w-10 sm:h-10"
                        strokeWidth={1.5}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <input
                        type="text"
                        value={appSettings.osName ?? ""}
                        onChange={(e) =>
                          onSettingsChange({ osName: e.target.value })
                        }
                        className={cn(
                          "aerie-field w-full rounded-xl px-3 py-2 focus:outline-none text-lg italic tracking-tight mb-1",
                          colors.textMain,
                        )}
                        placeholder="e.g. Aerie OS"
                      />
                      <p
                        className={cn(
                          "text-[10px] sm:text-[11px] leading-relaxed font-medium break-words whitespace-normal text-left",
                          colors.textMuted,
                        )}
                      >
                        Your personal OS name.
                      </p>
                    </div>
                  </div>

                  <div className="pt-4">
                    <h3 className={cn("micro-label mb-3", colors.accentText)}>
                      Group Chat Name
                    </h3>
                    <input
                      type="text"
                      value={appSettings.groupChatName ?? ""}
                      onChange={(e) =>
                        onSettingsChange({ groupChatName: e.target.value })
                      }
                      className={cn(
                        "aerie-field w-full rounded-xl px-3 py-2 focus:outline-none text-sm",
                        colors.textMain,
                      )}
                      placeholder="Aerie"
                    />
                    <p
                      className={cn(
                        "text-[10px] sm:text-[11px] leading-relaxed font-medium mt-1",
                        colors.textMuted,
                      )}
                    >
                      Appears at the top of your chat interface.
                    </p>
                  </div>

                </div>
              </section>

              </>)}
              {pane === 'look' && (<>
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

              </>)}
              {pane === 'look' && (<>
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
                                  color: '#ffffff',
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

              </>)}
              {pane === 'home' && (<>
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

              </>)}
              {pane === 'home' && (<>
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
              </>)}
            </>
          )}



          {activeTab === "data" && (
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
                        Enable native push notifications
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
              <AppUpdate themeConfig={activeTheme} themeMode={theme.mode} />
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
};
