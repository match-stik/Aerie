# Aerie Glass Reskin

This build keeps Aerie's existing information architecture, wallpapers,
features, routes, and color palettes. It replaces the shared phone chrome with
a neutral glass system that uses the selected theme color only for interaction
and state.

## Interaction model

- Dock and app-drawer tiles are neutral at rest.
- Pressing a tile shifts its icon, border, label, and restrained glow to the
  active theme color.
- Home-screen navigation pauses for 135 ms so the press response remains
  visible before the destination opens.
- Unread badges, focus rings, send controls, and active states inherit the
  selected theme accent automatically.
- Both Daylight and Midnight modes supply their own neutral glass surfaces.
- Wallpapers remain full-bleed and unobstructed outside the compact dock.

## Shared surfaces

The reskin reaches:

- wallpaper-first home dock and lock control
- app drawer, search field, tiles, and drag ghost
- feature-app headers and bodies through `AppShell`
- Messages header, composer, toolbar, send control, and message bubbles
- Settings and other feature screens that already use the shared shell

## Theme behavior

No palette was removed or hard-coded to orange. The existing theme picker still
controls the accent. The shared CSS variables are written in `App.tsx` whenever
the palette or Daylight/Midnight mode changes:

- `--aerie-accent`
- `--aerie-page`
- `--aerie-surface`
- `--aerie-surface-strong`
- `--aerie-hairline`
- `--aerie-icon`
- `--aerie-label`

The visual system itself lives in `packages/phone/src/index.css` under the
`Aerie Glass` section.

## Verification

From `packages/phone`:

```sh
npm install
npm run check
npm run build
```

The reskin was verified with TypeScript and a production Vite build.
