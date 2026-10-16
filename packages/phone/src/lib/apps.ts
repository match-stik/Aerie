// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// App registry — the single source of truth for the phone's launchable apps.
// Consumed by the home-screen dock and the app drawer.

import { useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import { MessageSquare, Radar, CloudSun, StickyNote, Gamepad2, Settings, Activity, Sticker, LayoutDashboard, Plug, FileText, Bot, Users, TreePine, Brain, Paintbrush, Box, FolderOpen, BookOpen, PawPrint, Newspaper, Inbox, Mail, MapPin, LibraryBig, Music, Telescope, Waves } from 'lucide-react';
import type { OsScreen } from '../App';
import { STORY_SHELF_APP_ID, STORY_SHELF_NAME } from './story-shelf';
import { SPOTIFY_APP_ID } from './spotify';

export interface AppDef {
  id: string;
  name: string;
  icon: LucideIcon;
  category: 'Companion' | 'Tools' | 'Fun' | 'System';
  // 'screen' apps swap the OS into a full-screen view; 'modal' apps open an overlay.
  kind: 'screen' | 'modal';
  screen?: OsScreen;
  // Shown on the home-screen dock (the curated quick-access row).
  dock?: boolean;
}

export const APPS: AppDef[] = [
  { id: 'messages', name: 'Messages', icon: MessageSquare, category: 'Companion', kind: 'screen', screen: 'messages', dock: true },
  { id: 'status', name: 'Status', icon: Activity, category: 'System', kind: 'screen', screen: 'status' },
  { id: 'integrations', name: 'Integrations', icon: Plug, category: 'System', kind: 'screen', screen: 'integrations' },
  { id: 'agent', name: 'Agent', icon: Bot, category: 'System', kind: 'screen', screen: 'agent' },
  { id: 'packs', name: 'Packs', icon: Sticker, category: 'System', kind: 'screen', screen: 'packs' },
  { id: 'commandcenter', name: 'Command Center', icon: LayoutDashboard, category: 'Companion', kind: 'screen', screen: 'commandcenter' },
  { id: 'canvas', name: 'Canvas', icon: FileText, category: 'Companion', kind: 'screen', screen: 'canvas' },
  { id: 'press', name: 'The Press', icon: Newspaper, category: 'Companion', kind: 'screen', screen: 'press' },
  { id: 'companions', name: 'Companions', icon: Users, category: 'Companion', kind: 'screen', screen: 'companions' },
  { id: 'treehouse', name: 'Treehouse', icon: TreePine, category: 'Companion', kind: 'screen', screen: 'treehouse' },
  { id: 'memory', name: 'Memory', icon: Brain, category: 'Companion', kind: 'screen', screen: 'memory' },
  { id: 'journal', name: 'Journal', icon: BookOpen, category: 'Companion', kind: 'screen', screen: 'journal' },
  // The owner field notes: what the morning look found, in plain words.
  { id: 'fieldnotes', name: 'Field Notes', icon: Telescope, category: 'Companion', kind: 'screen', screen: 'fieldnotes' },
  { id: 'letters', name: 'Letters', icon: Mail, category: 'Companion', kind: 'screen', screen: 'letters' },
  { id: 'thresholds', name: 'Thresholds', icon: MapPin, category: 'Companion', kind: 'screen', screen: 'thresholds' },
  { id: 'toys', name: 'Toys', icon: Waves, category: 'Companion', kind: 'screen', screen: 'toys' },
  // The Story Shelf: books the companions write and run, and the owner reads.
  { id: STORY_SHELF_APP_ID, name: STORY_SHELF_NAME, icon: LibraryBig, category: 'Companion', kind: 'screen', screen: 'shelf' },
  { id: 'pet', name: 'Familiar', icon: PawPrint, category: 'Fun', kind: 'screen', screen: 'pet' },
  { id: 'studio', name: 'Studio', icon: Paintbrush, category: 'Tools', kind: 'screen', screen: 'studio' },
  { id: 'files', name: 'Files', icon: FolderOpen, category: 'Tools', kind: 'screen', screen: 'files' },
  { id: 'inbox', name: 'Inbox', icon: Inbox, category: 'Tools', kind: 'screen', screen: 'inbox' },
  { id: 'artifacts', name: 'Artifacts', icon: Box, category: 'Tools', kind: 'screen', screen: 'artifacts' },
  { id: 'settings', name: 'Settings', icon: Settings, category: 'System', kind: 'modal' },
  { id: 'radar', name: 'Radar', icon: Radar, category: 'Tools', kind: 'screen', screen: 'radar', dock: true },
  { id: 'weather', name: 'Weather', icon: CloudSun, category: 'Tools', kind: 'screen', screen: 'weather', dock: true },
  { id: 'notes', name: 'Notes', icon: StickyNote, category: 'Tools', kind: 'screen', screen: 'notes', dock: true },
  { id: 'games', name: 'Games', icon: Gamepad2, category: 'Fun', kind: 'screen', screen: 'games' },
  // Spotify, for seeing: the owner listening with a cover on everything. Read only.
  { id: SPOTIFY_APP_ID, name: 'Spotify', icon: Music, category: 'Fun', kind: 'screen', screen: 'spotify' },
];

/** The name an app shows under its icon. A house can rename an app it owns;
 *  the kit ships every app under its own name, so this is the name as written
 *  (the house's copy reads its renames here). */
export function useAppName(): (app: AppDef) => string {
  return useCallback((app: AppDef) => app.name, []);
}

export const DOCK_APPS = APPS.filter((a) => a.dock);

export const CATEGORY_ORDER: AppDef['category'][] = ['Companion', 'Tools', 'Fun', 'System'];

export function appsByCategory(): Array<{ category: AppDef['category']; apps: AppDef[] }> {
  return CATEGORY_ORDER.map((category) => ({
    category,
    apps: APPS.filter((a) => a.category === category),
  })).filter((g) => g.apps.length > 0);
}

// --- Custom drawer layout, persisted in localStorage. ----------------------
//
// The drawer is a sparse grid: each slot holds either an app id or null
// (an empty cell). Storage matches that shape — a positional array
// where indexes are grid slots and nulls are gaps. Lets the user place
// apps wherever they want (e.g. centering an odd row) instead of being
// forced into a left-to-right fill.

const LAYOUT_STORAGE_KEY = 'aerie_app_layout_v1';
const LEGACY_ORDER_STORAGE_KEY = 'aerie_app_order_v1';

export type AppSlot = string | null;

/** How many apps sit in a row of the drawer. Unset is four, the drawer as it
 *  always was. */
export type DrawerColumns = 4 | 5;
export function drawerColumnsOf(value: unknown): DrawerColumns {
  return value === 5 ? 5 : 4;
}

/** Each row size keeps its own arrangement, so moving apps about at five never
 *  scrambles the layout at four. Four keeps the key it always had. */
function layoutKey(columns: DrawerColumns): string {
  return columns === 4 ? LAYOUT_STORAGE_KEY : `${LAYOUT_STORAGE_KEY}_c${columns}`;
}

/** A row size opened for the first time starts from the other one's order with
 *  its gaps taken out: a gap placed to centre a row of four means nothing in a
 *  row of five. */
export function seedLayoutFrom(slots: AppSlot[]): AppSlot[] {
  return slots.filter((slot): slot is string => Boolean(slot));
}

const APP_ID_ALIASES: Record<string, string> = {
  // GIF Lab became a first-class Studio section. Keep old saved dock/drawer
  // layouts useful instead of leaving a dead tile behind.
  gif: 'studio',
  // X-Ray folded into Agent (Wakes/Runtime/Identity tabs).
  xray: 'agent',
  // Cortex, Memory Blocks, and Self-Knowledge folded into the Memory hub.
  cortex: 'memory',
  memoryblocks: 'memory',
  selfknowledge: 'memory',
};

export function migrateAppIds(ids: string[]): string[] {
  const canonicalPresent = new Set(ids.filter((id) => !APP_ID_ALIASES[id]));
  const seen = new Set<string>();
  const migrated: string[] = [];
  for (const id of ids) {
    const target = APP_ID_ALIASES[id] ?? id;
    if (APP_ID_ALIASES[id] && canonicalPresent.has(target)) continue;
    if (seen.has(target)) continue;
    seen.add(target);
    migrated.push(target);
  }
  return migrated;
}

function migrateLayoutSlots(slots: AppSlot[]): AppSlot[] {
  const canonicalPresent = new Set(slots.filter((id): id is string => Boolean(id) && !APP_ID_ALIASES[id as string]));
  const seen = new Set<string>();
  return slots.map((slot) => {
    if (!slot) return null;
    const target = APP_ID_ALIASES[slot] ?? slot;
    if (APP_ID_ALIASES[slot] && canonicalPresent.has(target)) return null;
    if (seen.has(target)) return null;
    seen.add(target);
    return target;
  });
}

/**
 * Drop the empty slots after the last app. Edit mode pads two whole empty rows
 * onto the end for room to shuffle, and every drop saved them, so each
 * rearrange left two more invisible rows under the apps and the drawer scrolled
 * into nothing. Gaps BETWEEN apps were placed on purpose and stay.
 */
export function trimTrailingEmpty<T>(slots: Array<T | null>): Array<T | null> {
  let end = slots.length;
  while (end > 0 && !slots[end - 1]) end--;
  return slots.slice(0, end);
}

export function loadAppLayout(columns: DrawerColumns = 4): AppSlot[] | null {
  try {
    const raw = localStorage.getItem(layoutKey(columns));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((v) => v === null || typeof v === 'string')) {
        const migrated = trimTrailingEmpty(migrateLayoutSlots(parsed as AppSlot[]));
        if (JSON.stringify(migrated) !== JSON.stringify(parsed)) saveAppLayout(migrated, columns);
        return migrated;
      }
    }
    if (columns !== 4) {
      const four = loadAppLayout(4);
      return four ? seedLayoutFrom(four) : null;
    }
    // One-time migration from the older v1 ordered-list format. Empty
    // layout (no gaps), apps in saved order.
    const legacy = localStorage.getItem(LEGACY_ORDER_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
        return migrateLayoutSlots(parsed as AppSlot[]);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function saveAppLayout(slots: AppSlot[], columns: DrawerColumns = 4): void {
  try {
    localStorage.setItem(layoutKey(columns), JSON.stringify(slots));
  } catch {
    /* localStorage unavailable — ignore */
  }
}

// Resolve a sparse layout against the canonical APPS list. Slots that
// reference unknown ids become empty; apps not yet placed (e.g. newly
// added in a later build) are appended at the end so the user doesn't
// silently lose access. Returns an array of (AppDef | null) the drawer
// can render directly.
export function applyAppLayout(
  apps: AppDef[],
  layout: AppSlot[] | null,
): Array<AppDef | null> {
  if (!layout) return [...apps].sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(apps.map((a) => [a.id, a]));
  const placed = new Set<string>();
  const resolved: Array<AppDef | null> = [];
  for (const slot of layout) {
    if (slot && byId.has(slot) && !placed.has(slot)) {
      resolved.push(byId.get(slot) || null);
      placed.add(slot);
    } else {
      resolved.push(null);
    }
  }
  // Insert unplaced apps alphabetically rather than appending at the end,
  // so new apps land where the user would expect them.
  const unplaced = apps.filter((a) => !placed.has(a.id)).sort((a, b) => a.name.localeCompare(b.name));
  for (const app of unplaced) {
    // Find the right alphabetical position among already-placed apps
    let insertIdx = resolved.length;
    for (let i = 0; i < resolved.length; i++) {
      const slot = resolved[i];
      if (slot && app.name.localeCompare(slot.name) < 0) {
        insertIdx = i;
        break;
      }
    }
    resolved.splice(insertIdx, 0, app);
  }
  return resolved;
}
