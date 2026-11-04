# Making a Press page from a lane

How a companion puts a scrapbook page together without opening the editor: pictures, torn edges, tape, stickers, brush stamps and ink doodles, all as layers their person can move afterwards. Everything here goes through the public app behind the sign-in cookie (`/api/press/...` on the app's own port), the same doors the phone uses.

## The shape of a page

An issue holds spreads, and a spread's `scene_json` is an Excalidraw document wrapped in a Press envelope:

    { "version": 1,
      "page": { "x": 0, "y": 0, "width": 1080, "height": 1350, "background": "#fffaf0" },
      "elements": [ ...Excalidraw elements... ],
      "appState": { ... },
      "files": { "<fileId>": <file ref>, ... } }

The first two elements are the paper: a rectangle with `customData.press.kind` of `page-shadow`, then one of `page`. Copy them from an existing spread rather than inventing them. Everything else sits on top, in the order of the list.

Make the issue with `POST /api/press/issues` `{title, subtitle, format:"portrait"}` (it comes with one spread), add spreads with `POST /api/press/issues/:id/spreads` `{title}`, and write a page with `PATCH /api/press/spreads/:id` `{title, sceneJson}`, where `sceneJson` is the document as a string.

## Pictures

Upload the image (see Uploads below), then put an `image` element on the page whose `fileId` is the upload's id, and a matching entry in `files`:

    "customData": { "press": { "kind": "photo", "mimeType": "image/png",
      "storageFileId": "<shown file>", "sourceFileId": "<original>", "assetId": "<asset>",
      "recipe": { "kind": "photo", "edgePreset": "soft-tear", "seed": 123, "adjustments": {} } } }

The files entry carries the same fields plus `"id"` and `"kind": "photo"`. Register an asset for it with `POST /api/press/assets` `{issueId, spreadId, sourceFileId, renderedFileId?, kind:"photo", name, mimeType, recipe}`.

Keep the element's width and height in the picture's own proportions. A tall picture in a wide box is drawn stretched.

## Torn edges

The recipe only describes the edge; it does not cut it. The phone cuts the picture when its person picks an edge in the editor. From a lane, cut it yourself and upload the result: mask the picture to the edge polygon (the same one `polygonMask` draws in `packages/phone/src/components/press/materials.ts`, with `mulberry32` from `@aerie/shared` for the jitter), save it as a PNG with transparency, then point `storageFileId` and `fileId` at the cut copy and keep `sourceFileId` as the original. Presets: `clean`, `soft-tear`, `deckled`, `ripped-corners`, `scalloped`.

## Tape

Tape is a recipe drawn as SVG. `tapeMaterial(preset, {color, seed})` from `@aerie/shared` (`press-tape.ts`) returns the recipe and a data URL. Put the recipe on the element as `customData.press`, and in `files` an entry `{id, kind:"material", mimeType:"image/svg+xml", inlineDataURL, recipe}`. Presets: `masking`, `vellum`, `paper`, `repair`. About three times as wide as it is tall, laid across a picture's top edge, looks right.

## Stickers and brush stamps

A sticker or a brush stamp is a picture with the `clean` edge, and like any picture it keeps its own proportions: read the file's size, because almost no sticker is square. A Photoshop brush (`.abr`) imported in the editor becomes a pack of transparent stamps in Materials. From a lane you can read the tips with `parseAbr` in `packages/phone/src/components/press/abr-parser.ts` (it runs in Node with type stripping), colour them, upload them and place them like any picture. A big brush file can be hundreds of megabytes; the parser keeps tips to 512 pixels on the long side. Check a brush set's licence before using it; most free ones forbid passing the files themselves on.

## Doodles and patterns

Ordinary Excalidraw shapes work and stay editable: `freedraw` strokes for stars, hearts and spirals, a dashed `line` for a path, an `ellipse` for a stamp ring, a `rectangle` with `fillStyle` set to `hachure`, `cross-hatch` or `zigzag` for patterned backing paper. Give each the usual element fields (`id`, `type`, `x`, `y`, `width`, `height`, `angle`, `strokeColor`, `backgroundColor`, `fillStyle`, `strokeWidth`, `strokeStyle`, `roughness`, `opacity`, `seed`, `version`, `versionNonce`, `isDeleted:false`, `groupIds:[]`, `boundElements:null`, `locked:false`), plus `points` for lines and strokes. The editor fills in anything missing when the page opens.

## Leave the words to them

A scrapbook page's caption belongs to the person whose scrapbook it is. Leave open paper for it.

## Uploads

`POST /api/files` takes about ten uploads a minute and then answers 429. Press materials can go through `POST /api/press/item-files` instead, which answers with the same `fileId`.

## The shelf picture

The shelf shows a small picture of each page, and only a drawing can paint it, which a lane is not. A scene saved without a picture marks the page stale (`thumbnail_stale`), `GET /api/press/spreads/stale` lists those, and the phone's shelf paints them the next time it opens. So after composing a page there is nothing to do. On a house older than that, the picture catches up the first time the page is opened in the editor.

## Check it before you hand it over

Read your page back with `GET /api/press/issues/:id`, and look at it. A preview you draw yourself (the photos pasted at their x, y and angle) catches stretched pictures and crowded layouts, but only the editor draws doodles and tape the way their person will see them.
