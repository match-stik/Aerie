# The Press — Build Bible

The Press is Aerie's mobile-first mixed-media zine and scrapbook studio. It is
not a whiteboard with a distressed font. Excalidraw supplies the editing
chassis; Aerie supplies books, ordered spreads, material presets, asset
drawers, companion contributions, and export.

## Product law

1. **Keep the recipe.** Editing never destroys the imported original. A torn
   photo stores the source file, edge preset, seed, crop, and rendered preview.
   A different tear can always be generated later.
2. **Touch is the primary input.** Every essential action has a visible,
   thumb-sized control. Precision work cannot depend on hover, right-click, or
   an undisclosed gesture.
3. **Preview light, export clean.** The editor may use bounded previews for
   speed. Final export re-renders from source recipes at the requested size.
4. **A spread remains editable.** Scene elements, file references, and
   material recipes are persisted, never just a flattened screenshot.
5. **The chassis is not the product.** Excalidraw stays behind an adapter. The
   Press document format and material recipes do not depend on private editor
   internals and can migrate to another renderer if necessary.
6. **The house is the asset drawer.** Gallery art, uploads, stickers, emotes,
   voice notes, and later companion contributions enter through explicit
   bridges rather than duplicate stores.

## First vertical slice

- The Press appears as a Phone app.
- Create, rename, open, and delete issues.
- Every issue contains ordered spreads; add, rename, reorder, and delete them.
- A spread opens in a lazy-loaded Excalidraw editor with drawing, text, shapes,
  selection, transform handles, and undo/redo.
- Autosave persists a versioned scene document without base64 photo payloads.
- Import a photo through The Press so the original is uploaded and tracked.
- The mobile Materials tray exposes **Edges / Borders / Tape**.
- Edge presets render actual alpha transparency while retaining the original.
- Border presets remain independent/grouped scene elements.
- Tape is a draggable, rotatable, resizable layer with color and opacity.
- Export the active spread to PNG.
- Aerie-themed editor chrome sits over a near-black cutting table while the
  printable paper color remains part of the saved spread.
- The hamburger is a Press menu: Add, Arrange, View, Packs, and File.
- Selected images get one-tap Fit, Fill + Crop, Stretch, and Center controls.
- Object snapping, a persistent Fit Page control, and deliberate arrangement
  actions replace the accidental long-press object menu on touch.
- House-global Packs import loose images, image ZIPs, and `.excalidrawlib`
  object libraries.
- Photoshop `.abr` packs are parsed in a worker; their original file is
  retained, readable brush parameters are preserved, and every extracted tip
  becomes a transparent reusable stamp.
- Selected imported photos open in a mobile Photo Lab with nondestructive
  exposure, contrast, temperature/tint, saturation, vibrance, and black-and-
  white adjustments; bounded worker previews; hold-for-before comparison; and
  one print-resolution commit from the untouched source.

## Package and file seams

```text
packages/shared/src/types.ts
  PressIssue / PressSpread / PressAsset API contracts

packages/backend/migrations/007_press.sql
  press_issues / press_spreads / press_assets

packages/backend/migrations/008_press_packs.sql
  press_packs / press_pack_items (global reusable shelves)

packages/backend/src/routes/press.ts
  /api/press/issues
  /api/press/issues/:id
  /api/press/issues/:id/spreads
  /api/press/spreads/:id
  /api/press/issues/:id/spreads/order
  /api/press/assets
  /api/press/assets/:id
  /api/press/packs
  /api/press/packs/:id

packages/phone/src/components/PressApp.tsx
  issue shelf, spread rail, editor shell

packages/phone/src/components/press/PressEditor.tsx
  lazy Excalidraw adapter, autosave, import, export, material operations

packages/phone/src/components/press/materials.ts
  deterministic alpha masks and generated tape material

packages/phone/src/components/press/photo-adjustments.ts
  versioned Photo Lab recipes, controls, looks, and pixel kernels

packages/phone/src/components/press/photo-renderer.ts / press-image.worker.ts
  cancellable bounded previews and final source-based raster rendering

packages/phone/src/components/press/abr-parser.ts / abr.worker.ts / abr.ts
  bounded ABR parsing off the main thread and transparent tip rendering

packages/phone/src/components/press/press.css
  Aerie → Excalidraw theme bridge and touch containment

packages/phone/src/components/press/types.ts
  versioned Press scene document and material recipes
```

## Persistence model

### `press_issues`

An ordered book/issue shell: title, subtitle, format, page dimensions, optional
cover spread, and timestamps.

### `press_spreads`

One editable scene per ordered spread. `scene_json` contains editor elements,
a deliberately small app-state subset, and Press file references. It never
stores imported image base64.

### `press_assets`

Tracks originals and replaceable rendered previews so file cleanup never
mistakes scrapbook material for an orphan. One placed photo may have its own
asset recipe even when several placements share one original later.

### `press_packs` / `press_pack_items`

Reusable shelves are global to Aerie. Loose PNG/JPG/WebP/GIF files and images
inside ZIPs remain file-backed stamp assets; sanitized SVGs are rasterized to
transparent PNG stamps before upload, while `.excalidrawlib` items retain their
native editable vector elements. ABR shelves retain the imported source file
and pack-level import notes; each rendered tip keeps diameter, hardness,
spacing, angle, roundness, and sampled/computed provenance in item metadata.
An optional `press-pack.json` in a ZIP carries name, description, author, and
license without making a manifest mandatory.

### Scene document v1

```ts
interface PressSceneDocumentV1 {
  version: 1;
  page: {
    width: number;
    height: number;
    background: string;
  };
  elements: ExcalidrawElement[];
  appState: {
    viewBackgroundColor: string;
    gridSize?: number | null;
  };
  files: Record<string, PressFileRef>;
}
```

`PressFileRef` points either to an Aerie file UUID (photos and rendered
previews) or a compact generated material recipe/data URL (tape). Opening a
spread rehydrates those references into Excalidraw's in-memory `BinaryFiles`.

## Material model

### Edges

An edge recipe is `{ preset, seed, sourceFileId, renderedFileId }`. The mask is
generated from normalized coordinates, so portrait, landscape, and square
families retain their shape without stretching one texture over everything.
The first presets are clean, soft tear, deckled, ripped corners, and scalloped.
`Shuffle Tear` keeps the preset and rotates only the deterministic seed.

### Borders

Borders are separate scene elements grouped with a target photo. Initial
presets: ink, stitched, and instant-film. They can be selected, restyled,
reordered, or deleted without touching photo pixels.

### Tape

Tape is a generated SVG image element with a recipe in `customData`. Its tint
is part of the material; opacity is an editor property. It therefore preserves
wrinkles, grain, fibers, highlights, and torn ends while remaining recolorable.
Initial presets: masking, vellum, paper, and repair tape.

## Mobile interaction

- Editor fills the available Phone viewport; the app body does not scroll.
- A bottom Materials button opens a thumb-height sheet.
- Tabs and preset cards use at least 44px touch targets.
- Selected-photo-only actions explain what must be selected instead of simply
  failing.
- Tape is placed near the page center and then uses visible editor transform
  handles for move, resize, and rotation.
- Color and opacity controls remain in the sheet; no desktop properties panel
  is required for the core material flow.
- Autosave is debounced, reports saving/saved/error, and flushes when leaving.

## Export path

The first slice exports the active scene to PNG through Excalidraw. The final
Press exporter will instead walk Press recipes at requested resolution, clip
to the page/spread bounds, flatten interactive objects gracefully, and bind
ordered spreads into a printable PDF/ZIP edition.

## Later doors

- Gallery, Files, and voice-note drawers; richer pack metadata/editing
- custom user masks, borders, tape, and saved material combinations
- cover templates and spread templates
- page/spread mode with bleed, trim, and safe-area guides
- companion contribution invitations with provenance and accept/edit controls
- interactive audio/link objects that flatten to QR/link marks for print
- issue thumbnails, autosaved revisions, duplicate spread, and restore history
- bound-edition PDF export and image ZIP export
- shared/collaborative editing after the single-house document model is proven

## Stamps are here; real brushes are the next machinery

The Packs schema deliberately distinguishes reusable placed objects from tool
behavior. Image assets behave as stamps, `.excalidrawlib` files become reusable
vector objects in the native library, and **ABR-to-stamps is now implemented**:
Photoshop brush tips are parsed in a worker, the original source is preserved,
every readable raster or computed tip becomes a visible pack item, and the
parameters the later engine can honor are retained instead of flattened away.

True painted brushes need a raster stroke layer rather than pretending a row
of Excalidraw freehand vectors is Photoshop. That engine is the next creative
layer after stamp import, with these non-negotiable controls:

- size, opacity, **flow**, spacing, hardness, rotation, scatter, and jitter
- pressure-aware size/flow when the device supplies pressure, with touch-safe
  sliders when it does not
- blend mode, eraser behavior, undoable raster strokes, and bounded previews
- a mobile Brush Lab that can create a brush from a PNG, transparent crop, or
  selected canvas region; preview it; name it; tag it; and save it to a
  house-global pack
- one engine for both stamping and painting: a stamp is a brush tip placed
  once, while brush flow repeats and blends that tip along a path

The scene document will store the editable raster layer plus its stroke/brush
recipes; export replays or composites the full-resolution layer. This keeps
creatable brushes portable and editable without welding The Press document
format to one rendering chassis.

## Acceptance tests for the foundation

1. Create an issue on a narrow phone viewport and reopen it after refresh.
2. Add three spreads, reorder them, and confirm order survives restart.
3. Import a portrait and a landscape photo; neither scene JSON contains their
   base64 payload.
4. Apply every edge preset and confirm corner pixels contain real alpha.
5. Shuffle a tear, reopen the spread, and get the same seeded edge.
6. Add tape, recolor it, change opacity, rotate/resize it, and reopen unchanged.
7. Delete an issue and verify its database rows disappear while file cleanup
   treats still-referenced Press assets as in use.
8. Export the spread and confirm transparency is correctly composited against
   the chosen paper background.
9. Build the Phone with The Press unopened and confirm Excalidraw remains a
   lazy chunk rather than inflating initial startup.
10. Switch Aerie themes and confirm Press menus follow the active palette while
    the paper and exported PNG do not change color.
11. Long-press while resizing on a phone and confirm no object-menu ambush.
12. Import loose images, an image ZIP, and an `.excalidrawlib`; reopen another
    issue and confirm the same house-global packs remain available.
13. Import synthetic legacy v1 and modern v6 `.abr` fixtures; confirm parsing
    stays off the canvas thread, transparent stamps place correctly, the
    original source remains in use, and brush parameters survive in metadata.
