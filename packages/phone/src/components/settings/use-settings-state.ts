// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { useBackHandler } from '../../lib/use-back-handler';
import React, { useRef, useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import { PushNotifications } from "@capacitor/push-notifications";
import { disableWebPush, enableWebPush } from "../../lib/web-push";
import { Capacitor } from "@capacitor/core";
import { AppTheme, ThemeId, AppSettings, EmojiPack } from "../../types";
import { THEMES } from "../../lib/theme";
import { useAppName } from "../../lib/apps";
import { noteColorsForAccent, noteColorsForPalette } from '../../lib/note-colors';
import getCroppedImg from "../../lib/cropImage";
import { houseKeepsLinkedFiles, storeInlinePicture } from "../../aerie";


// Determine if a hex color is near-white (needs black foreground for contrast)
// Only returns true for very light colors like mono's #FAFAFA — most accent colors get white text
export function isNearWhite(hex: string): boolean {
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

export interface SettingsDashboardProps {
  theme: AppTheme;
  appSettings: Omit<AppSettings, "theme" | "contacts">;
  onThemeChange: (theme: Partial<AppTheme>) => void;
  onSettingsChange: (
    settings: Partial<Omit<AppSettings, "theme" | "contacts">>,
  ) => void;
  onClose: () => void;
  /** Their person's name, for the bubble preview's label. */
  ownerName?: string;
  /** Their person emoji packs, for the quick-reaction picker's tabs. */
  emojiPacks?: EmojiPack[];
}

export function useSettingsState({
  theme,
  appSettings,
  onThemeChange,
  onSettingsChange,
  onClose,
  ownerName = "You",
  emojiPacks,
}: SettingsDashboardProps) {
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
        // A browser: web push (lib/web-push.ts). The worker it uses only shows
        // a notification and brings the house forward on a tap; it caches
        // nothing and controls no page, unlike the one pulled in May.
        const out = await enableWebPush();
        if (out.ok === false) {
          alert(out.reason);
          return;
        }
      }
    } else if (!Capacitor.isNativePlatform()) {
      // Off in a browser means this browser stops getting them; other
      // devices keep theirs.
      await disableWebPush();
    }

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


  return {
    fileInputRef,
    avatarInputRef,
    oursPreviewRef,
    minePreviewRef,
    activeTheme,
    colors,
    themeNoteColors,
    shownNoteColors,
    resolvedAccent,
    activeTab,
    setActiveTab,
    pane,
    setPane,
    lockCorner,
    setLockCorner,
    nameOf,
    cropImageSrc,
    setCropImageSrc,
    cropTarget,
    setCropTarget,
    isSaving,
    setIsSaving,
    crop,
    setCrop,
    zoom,
    setZoom,
    croppedAreaPixels,
    setCroppedAreaPixels,
    handlePushToggle,
    downscaleAvatar,
    handleImageUpload,
    onCropComplete,
    storedPicture,
    handleSaveCrop,
    handleUseOriginal,
    saveImageResult,
    removeSlideshowImage,
    handleColorSelect,
    isColorSelected,
    theme,
    appSettings,
    onThemeChange,
    onSettingsChange,
    onClose,
    ownerName,
    emojiPacks,
  };
}

export type SettingsState = ReturnType<typeof useSettingsState>;
