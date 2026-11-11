# The Press — Graphite Raster Tool Study

Studied against Graphite `a770448bc988c8c4841e174edaa9b51b620c69ef`
(2026-07-15). The target is not to replace The Press or put a desktop node
editor inside the Phone. The target is to reuse the sound raster machinery
that helps The Press feel more like a real image editor while keeping its own
mobile-first workflow, document model, and visual language.

## Verdict

**Reuse the math and the nondestructive ideas, not the Graphite editor.**

Graphite's useful present-day raster surface is global image adjustment,
filter, gradient-map, masking, and blend-mode code. Its Photoshop-like local
tools are not a ready-made toolbox: the brush is still an experimental
prototype, while marquee masking, magic-wand selection, clone/history brush,
and liquify/warp remain roadmap work. Importing Graphite's complete WASM
frontend would also pull its editor, graph runtime, node registry, and GPU
stack into a mobile canvas that already has a chassis.

The clean seam is a small Press-owned raster worker with an ordered adjustment
recipe. Selected Graphite algorithms can be translated one at a time after
their output and provenance are audited. Excalidraw remains responsible for
layout and transforms; Press remains responsible for pixels, materials,
persistence, and touch UI.

## Implementation status — 2026-07-16

Photo Lab v1 now ships the first vertical slice described below:

- a versioned, compact adjustment stack stored in each photo recipe;
- a cancellable worker that keeps a decoded source warm between completed
  previews and terminates stale in-flight work;
- 960px WebP live previews and source-based PNG commits targeting the larger
  of the current page size or 2400px on the long edge, without upscaling a
  smaller source;
- exposure, contrast, temperature, tint, saturation, vibrance, and black-and-
  white controls plus four visible recipe presets;
- hold-for-before, per-control reset, reset-all, Cancel, and one-upload Done;
- edge changes re-render the adjustment stack instead of erasing Photo Lab
  work;
- Graphite provenance in the adapted exposure implementation and Aerie
  `NOTICE`.

Levels, gradient map, channel mixer, blur, and blend modes remain the next
advanced-global slice; localized paint/selection machinery remains later work.

## What is useful now

| Graphite area | Available operations | Press judgment |
| --- | --- | --- |
| `adjustments.rs` | brightness/contrast, levels, black and white, hue/saturation/lightness, invert, threshold, vibrance, channel mixer, selective color, posterize, exposure | Strong source of algorithms and parameter conventions, but port only after visual fixtures. Several functions contain fidelity TODOs. |
| `filter.rs` | Gaussian blur, box blur, median filter | Blur is useful after an efficient worker implementation. Median filtering is too expensive for continuous full-resolution phone previews. |
| `dehaze.rs` | dark-channel-prior dehaze | Technically interesting, but multi-pass and allocation-heavy. Not a first mobile slice. |
| `gradient_map.rs` | luminance-to-gradient mapping | Small, expressive, and ideal for zine looks. Good early advanced effect. |
| `blending.rs` / `blending_nodes.rs` | Photoshop-style darken, lighten, contrast, inversion, component, erase, and alpha modes | Reuse the formulas later inside the derived-image compositor. Excalidraw image elements do not expose this complete per-layer model. |
| masking nodes | alpha/stencil composition | The right concept for future shape and painted masks, not a drop-in selection system. |
| brush nodes | diameter, color, hardness, flow, sampled stroke/stamp cache | Too tightly coupled to Graphene and explicitly due for a rewrite. Press's ABR metadata deserves a purpose-built stroke layer instead. |
| palette extraction | palette from raster input | Reimplement and test rather than copy; the current path deserves a correctness audit before use. |

### Fidelity cautions found in source

- Hue/saturation notes that saturation is slightly off and lightness is very
  off.
- Vibrance calls its result close but not perfect, notes darkening on negative
  values, and lacks the separate saturation control.
- Black-and-white blending and selective color still have correctness edges.
- Gaussian blur is a CPU separable convolution with several image-sized
  buffers; median filter examines a radius-sized neighborhood for every pixel.
- Dehaze performs multiple whole-image passes and currently cannot cache its
  expensive invariant work while the strength slider changes.

Those are reasons to build golden-image tests, not reasons to discard the
whole source. The first ports should be the small, obvious kernels: exposure,
levels, invert, threshold, and posterize.

## Press-native architecture

The current photo path already has the correct bones:

```text
immutable sourceFileId
        +
versioned material/adjustment recipe
        ↓
replaceable renderedFileId
        ↓
Excalidraw image element for placement/crop/transform
```

`PhotoMaterialRecipe` should grow an ordered, versioned adjustment stack. The
source image remains immutable, and every render starts from that source—not
from the last adjusted preview—so sliders never compound damage.

```ts
type PhotoAdjustment =
  | { id: string; type: 'exposure'; enabled: boolean; exposure: number; offset: number; gamma: number }
  | { id: string; type: 'brightness-contrast'; enabled: boolean; brightness: number; contrast: number }
  | { id: string; type: 'levels'; enabled: boolean; shadows: number; midtones: number; highlights: number; outputMin: number; outputMax: number }
  | { id: string; type: 'temperature-tint'; enabled: boolean; temperature: number; tint: number }
  | { id: string; type: 'hue-saturation'; enabled: boolean; hue: number; saturation: number; lightness: number }
  | { id: string; type: 'vibrance'; enabled: boolean; amount: number }
  | { id: string; type: 'black-white'; enabled: boolean; tint: string; amount: number }
  | { id: string; type: 'posterize' | 'threshold' | 'invert'; enabled: boolean; amount?: number };
```

The exact persisted union should be additive and tolerate unknown future
entries. Each adjustment gets its own ID, enabled state, values, defaults, and
schema version so a spread can reopen unchanged after the editor grows.

### Render pipeline

1. Decode and cache the immutable source in `press-image.worker.ts`.
2. Render a bounded live preview at roughly 960–1200 pixels on its long edge.
3. Apply enabled adjustments in recipe order, then the existing physical edge
   mask. Cache lookup tables for slider-friendly operations.
4. Debounce slider traffic and cancel stale worker jobs; never upload a file
   for every finger movement.
5. On **Done**, render at page/export resolution, upload one derived file, and
   atomically update `renderedFileId` plus the recipe.
6. Export re-renders from the immutable source at final resolution rather than
   trusting the bounded editor preview.

The current `renderEdgePreview(..., maxDimension = 1500)` conflates preview
and committed output. The raster worker is the right moment to split those two
quality modes.

### Mobile interaction

Do not copy Graphite's node graph or desktop panels. A selected photo gets a
clear **Edit photo** action opening a Phone-sized Photo Lab sheet:

- horizontal groups for Light, Color, Look, and Effects;
- one large active slider with a numeric value and reset;
- tap an adjustment to enable it, long-press/eye to compare, and reset either
  one adjustment or the whole image;
- press-and-hold the image for before/after;
- presets are named recipe bundles, never flattened mystery filters;
- **Cancel** restores the opening recipe and **Done** commits one derived
  image.

Keep **Materials** for physical collage behavior—edges, borders, tape, paper,
and later texture. Photo correction is related, but it is not a material.

## Build order

### Photo Lab v1 — highest return

1. Worker, job cancellation, source cache, preview/final quality split.
2. Versioned adjustment-stack persistence and legacy recipe migration.
3. Exposure, brightness/contrast, temperature/tint, saturation, vibrance,
   black and white, invert, reset, and before/after.
4. A few Press-native look presets built from visible adjustment recipes.
5. Golden fixtures plus phone timing and memory measurements.

Temperature/tint is deliberately Press-original; Graphite does not currently
supply it, but it is more useful in an everyday photo workflow than several
of the rarer adjustment nodes.

### Photo Lab v1.5 — advanced global controls

- Levels, threshold, posterize, gradient map, and channel mixer.
- Curves with a Press-owned implementation and touch-sized control points.
- Optimized blur, first as a committed effect rather than continuous
  full-resolution rendering.
- Blend modes for derived photo composites and texture layers.

### Later raster layer — not something Graphite can donate today

- real ABR-driven painted strokes and eraser;
- painted/vector masks and marquee/lasso/magic-wand selection;
- clone/heal, dodge/burn, history brush;
- liquify/warp and other localized deformation.

These require a raster-layer and undo model. They should not be faked as rows
of Excalidraw objects just to put familiar icons in the toolbar.

## Licensing and attribution

Graphite's repository root is Apache-2.0; its `raster-nodes` crate is offered
under MIT OR Apache-2.0. Aerie can legally reuse and modify that work. For any
actual translated or copied kernel we will:

1. record the upstream file, snapshot commit, and chosen license in the source
   header or a nearby provenance table;
2. mark the implementation as modified for Press;
3. add Graphite to Aerie's `NOTICE` and preserve the applicable license text;
4. preserve any file-level notices and audit comments that point to external
   algorithm sources before adopting that code;
5. add image fixtures proving our output rather than assuming upstream TODOs
   are acceptable.

The Photo Lab v1 implementation now adapts Graphite's exposure-node ordering,
so its source header records the upstream snapshot and Aerie's `NOTICE`
contains the Graphite attribution. Later ports must extend that provenance
rather than treating this first entry as blanket clearance for unaudited code.

## Acceptance bar for Photo Lab v1

1. Reopening a spread restores every adjustment and its order.
2. Reset reproduces the imported source pixels before the physical edge mask.
3. Repeated slider changes never compound against a prior preview.
4. Dragging a slider remains responsive on a representative phone-sized image;
   stale work cannot flash over a newer value.
5. Cancel makes no derived upload; Done makes no more than one.
6. Export uses a final-resolution render and visibly beats the live preview
   when enlarged.
7. Transparent source pixels and edge masks remain correct through all
   adjustments.
8. Before/after works without a desktop-only tooltip, keyboard command, hover,
   or right-click.
9. Every Graphite-derived kernel has provenance and golden-image coverage.

## Recommended first cut

Build the worker and recipe stack with **Exposure, Contrast, Temperature/Tint,
Saturation/Vibrance, Black & White, Reset, and press-and-hold Before/After**.
That is the smallest slice that changes The Press from arranging images to
actually developing them, without pretending the still-future Photoshop tools
already exist upstream.
