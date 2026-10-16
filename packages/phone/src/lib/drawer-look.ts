// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// How the app drawer's tiles look, apart from drawing them: icon size, shape,
// labels, icon color, tiles. Every choice starts as the drawer looks today, so
// nothing moves until the owner flips it. Kept free of imports so it can be
// tested.

export type IconSize = 'small' | 'medium' | 'large';
export type IconShape = 'rounded' | 'circle' | 'square';
export type DrawerLabels = 'card' | 'plain' | 'hidden';
export type IconColor = 'theme' | 'accent';

export interface DrawerLook {
  size: IconSize;
  shape: IconShape;
  /** Names under the tiles: on their little card, as plain text, or none. */
  labels: DrawerLabels;
  /** The icon drawn in the theme's icon color, or in its accent. */
  iconColor: IconColor;
  /** Each icon sits on its tile, or stands on its own over the wallpaper. */
  tiles: boolean;
}

/** The drawer as it has always looked. */
export const DEFAULT_DRAWER_LOOK: DrawerLook = { size: 'medium', shape: 'rounded', labels: 'card', iconColor: 'theme', tiles: true };

export function drawerLookOf(theme: { drawerIconSize?: unknown; drawerIconShape?: unknown; drawerLabels?: unknown; drawerIconColor?: unknown; drawerTiles?: unknown }): DrawerLook {
  return {
    size: theme.drawerIconSize === 'small' || theme.drawerIconSize === 'large' ? theme.drawerIconSize : 'medium',
    shape: theme.drawerIconShape === 'circle' || theme.drawerIconShape === 'square' ? theme.drawerIconShape : 'rounded',
    labels: theme.drawerLabels === 'plain' || theme.drawerLabels === 'hidden' ? theme.drawerLabels : 'card',
    iconColor: theme.drawerIconColor === 'accent' ? 'accent' : 'theme',
    tiles: theme.drawerTiles !== false,
  };
}

const TILE_PX: Record<IconSize, number> = { small: 48, medium: 56, large: 64 };
const ICON_PX: Record<IconSize, number> = { small: 24, medium: 28, large: 32 };

/** The icon's own size inside its tile. */
export function drawerIconPx(look: DrawerLook): number {
  return ICON_PX[look.size];
}

/**
 * The tile around an icon. Never wider than its cell, so a large tile at five
 * in a row shrinks to fit rather than pushing into its neighbors.
 */
export function drawerTileStyle(look: DrawerLook): Record<string, string> {
  const px = TILE_PX[look.size];
  const style: Record<string, string> = {
    width: `min(${px}px, 100%)`,
    aspectRatio: '1 / 1',
    height: 'auto',
    borderRadius: look.shape === 'circle' ? '9999px' : look.shape === 'square' ? '0.375rem' : '1rem',
  };
  if (look.iconColor === 'accent') style.color = 'var(--aerie-accent)';
  if (!look.tiles) {
    style.background = 'transparent';
    style.borderColor = 'transparent';
    style.boxShadow = 'none';
  }
  return style;
}
