// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Where their theme, contacts and settings live: loaded from this phone first,
// reconciled with the house, then written to both on every change. The one rule
// that matters is at the top of the reconciling effect: nothing is pushed to the
// house until the house has been read, so a stale phone can't overwrite it
// (~/tools/pagecheck/check-settings-sync.mjs watches that from outside).

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import localforage from 'localforage';
import { fetchServerSettings, houseKeepsLinkedFiles, pushServerSettings, storeInlinePicture } from '../aerie';
import { collectLocalExtras } from '../components/SetupSync';
import { migrateAppIds } from './apps';
import { KNOWN_THEME_IDS } from './use-app-theme';
import { guardTheme } from './theme-guard';
import { inlineWallpapers, swapWallpapers } from './wallpaper-files';
import type { AppSettings, AppTheme, ContactProfile } from '../types';

export function useSettingsSync({ theme, setTheme, contacts, setContacts, appSettings, setAppSettings, authenticated, onContactSaveFailed }: {
  theme: AppTheme;
  setTheme: Dispatch<SetStateAction<AppTheme>>;
  contacts: Record<string, ContactProfile>;
  setContacts: Dispatch<SetStateAction<Record<string, ContactProfile>>>;
  appSettings: AppSettings;
  setAppSettings: Dispatch<SetStateAction<AppSettings>>;
  authenticated: boolean;
  onContactSaveFailed: (message: string) => void;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  // Goes true once we've reconciled local state with whatever the server
  // had stored. Until then, we don't push changes back — would race the
  // initial fetch and risk overwriting newer server state with stale
  // localStorage from a different browser.
  const serverSettingsHydrated = useRef(false);
  // The same moment as state, so an effect can wait on it.
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  // Load from localforage on mount (for large data like base64 images)
  useEffect(() => {
    const loadPersistedData = async () => {
      try {
        const savedTheme = await localforage.getItem<AppTheme>('aerie_theme');
        if (savedTheme) {
          setTheme(guardTheme(savedTheme, KNOWN_THEME_IDS));
        }

        const savedContacts = await localforage.getItem<any>('aerie_contacts');
        if (savedContacts) {
          setContacts(savedContacts);
        }

        const savedSettings = await localforage.getItem<any>('aerie_settings');
        if (savedSettings) {
          const migrated = {
            ...savedSettings,
            ...(Array.isArray(savedSettings.dockAppIds) ? { dockAppIds: migrateAppIds(savedSettings.dockAppIds) } : {}),
          };
          setAppSettings(prev => ({ ...prev, ...migrated }));
        }
      } catch (e) {
        console.error('Failed to load data from localforage:', e);
      } finally {
        setIsLoaded(true);
      }
    };
    loadPersistedData();
  }, []);

  // After local cache is loaded + we're authenticated, reconcile against
  // the server blob so theme/contacts/appSettings follow the user across
  // browsers. Server wins for keys it knows about; if the server is
  // empty, the next push effect will seed it from whatever loaded
  // locally. Guarded by serverSettingsHydrated so we don't re-fire on
  // every state change.
  useEffect(() => {
    if (!isLoaded) return;
    if (!authenticated) return;
    if (serverSettingsHydrated.current) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async () => {
      try {
        const blob = await fetchServerSettings();
        if (cancelled) return;
        if (blob) {
          if (blob.theme) setTheme((prev) => guardTheme({ ...prev, ...blob.theme! }, KNOWN_THEME_IDS));
          if (blob.contacts) setContacts((prev) => ({ ...prev, ...blob.contacts! }));
          if (blob.appSettings) {
            const serverAppSettings = {
              ...blob.appSettings,
              ...(Array.isArray(blob.appSettings.dockAppIds)
                ? { dockAppIds: migrateAppIds(blob.appSettings.dockAppIds) }
                : {}),
            };
            setAppSettings((prev) => ({ ...prev, ...serverAppSettings }));
          }
        }
        // Only mark hydration complete when the fetch SUCCEEDED. A null
        // blob here means the server confirmed it has no stored settings
        // — safe to mark hydrated so the push effect seeds the server
        // with our local state. Errors (network / auth / parse) throw
        // and land in the catch below, leaving hydration false so the
        // push effect stays blocked and CAN'T overwrite the real
        // server-side data with local defaults.
        serverSettingsHydrated.current = true;
        setSettingsHydrated(true);
      } catch (err) {
        console.warn('[Settings] sync failed, will retry once:', err);
        if (cancelled || retryTimer) return;
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          if (!cancelled) void attempt();
        }, 5000);
      }
    };
    void attempt();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isLoaded, authenticated]);

  // Persist Theme (Local)
  useEffect(() => {
    if (!isLoaded) return;
    localforage.setItem('aerie_theme', theme).catch(e => {
      console.error('Failed to save theme to localforage:', e);
    });
    try {
      const themeForLocalStorage = { ...theme };
      delete themeForLocalStorage.wallpaper;
      delete themeForLocalStorage.lockScreenWallpaper;
      delete themeForLocalStorage.wallpapers;
      delete themeForLocalStorage.modeWallpapers;
      localStorage.setItem('aerie_theme', JSON.stringify(themeForLocalStorage));
    } catch (e) {}
  }, [theme, isLoaded]);

  // Persist Contacts
  useEffect(() => {
    if (!isLoaded) return;
    localforage.setItem('aerie_contacts', contacts).catch(e => {
      console.error('Failed to save contacts to localforage:', e);
      onContactSaveFailed('Failed to save contact image. The image might be too large.');
    });
    try {
      localStorage.setItem('aerie_contacts', JSON.stringify(contacts));
    } catch (e) {}
  }, [contacts, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localforage.setItem('aerie_settings', appSettings).catch(e => {
      console.error('Failed to save settings to localforage:', e);
    });
    try {
      localStorage.setItem('aerie_settings', JSON.stringify(appSettings));
    } catch (e) {}
  }, [appSettings, isLoaded]);

  // Push theme + contacts + appSettings to /api/settings whenever any
  // of them change. Debounced 1s so quickly-typed changes don't fire a
  // PUT per keystroke. Gated on serverSettingsHydrated.current so we
  // never overwrite the server with localStorage before reconciling.
  useEffect(() => {
    if (!isLoaded || !authenticated) return;
    if (!serverSettingsHydrated.current) return;
    const t = setTimeout(() => {
      void pushServerSettings({ theme, contacts, appSettings, extras: collectLocalExtras() });
    }, 1000);
    return () => clearTimeout(t);
  }, [theme, contacts, appSettings, isLoaded, authenticated]);

  // Wallpapers move out of the settings blob into the house's file store,
  // once per open, and only after the house has said it keeps the files its
  // settings link to (lib/wallpaper-files.ts). Each picture is swapped for
  // its link only once the house has confirmed it; anything that fails stays
  // inline and is tried again next time the app opens.
  const wallpaperMoveRan = useRef(false);
  useEffect(() => {
    if (!settingsHydrated || !authenticated || wallpaperMoveRan.current) return;
    if (!houseKeepsLinkedFiles()) return;
    const pending = inlineWallpapers(theme);
    if (pending.length === 0) return;
    wallpaperMoveRan.current = true;
    void (async () => {
      const links = new Map<string, string>();
      for (const picture of pending) {
        const link = await storeInlinePicture(picture);
        if (link) links.set(picture, link);
      }
      if (links.size > 0) setTheme((prev) => swapWallpapers(prev, links));
    })();
  }, [settingsHydrated, authenticated, theme]);

  return { isLoaded, settingsHydrated };
}
