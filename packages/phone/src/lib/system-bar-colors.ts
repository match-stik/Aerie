// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What color the system bars and the page behind everything wear, for each
// screen and mode. Kept free of imports so it can be tested without the app
// around it.

export interface BarInputs {
  mode: 'light' | 'dark';
  osState: string;
  hasWallpaper: boolean;
  showSettings: boolean;
  /** The theme's page color, already resolved to a real color. */
  pageBg: string;
}

export interface BarColors {
  /** The status bar (the theme-color meta) and, in the APK, the strip
   *  Android draws under the app. */
  bars: string;
  /** The page behind everything. */
  body: string;
}

/**
 * One frame per mode: white in Daylight, black in Midnight, with the theme's
 * color living inside it.
 *
 * The page behind the app wears the frame too. It is never seen except for
 * the instant a keyboard has closed and the app has not been redrawn at its
 * new height yet: the space the keyboard leaves is filled with this color, so
 * the theme's page color there showed as a block where the keyboard had been,
 * as if the footer had stretched up to the keyboard's height. In the
 * footer's color, that instant reads as the footer and nothing else.
 *
 * Over a wallpaper the body goes black, since a picture has no one color to
 * match. The home screen still keeps the frame, so coming home from a white
 * app does not flip the bar to black; the lock screen keeps its black bar.
 */
export function barColorsFor(input: BarInputs): BarColors {
  const frame = input.mode === 'light' ? '#FFFFFF' : '#000000';
  const overWallpaper = !input.showSettings
    && (input.osState === 'locked' || (input.osState === 'home' && input.hasWallpaper));
  if (!overWallpaper) return { bars: frame, body: frame };
  return { bars: input.osState === 'locked' ? '#000000' : frame, body: '#000000' };
}
