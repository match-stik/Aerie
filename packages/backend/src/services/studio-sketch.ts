// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * A sketch the user draws in Studio, handed to the generator as a reference.
 *
 * Studio has had a draw canvas for a while and there was no way to give what
 * the user drew to the picture they were making — though the technique is a good
 * one: twelve lines carrying a pose, and a model inventing everything else
 * around it.
 *
 * The receiving half already existed. generateImage takes `extraRefs` — a list
 * of unlabelled reference paths, distinct from the named subject drawers — and
 * nothing in this house ever set it. A door with no handle on the outside.
 *
 * WHY AN ID RATHER THAN A PATH: the client must never be able to name a file on
 * disk for the generator to read. It posts an image, gets an opaque uuid back,
 * and the generate route is the only thing that turns a uuid into a path. A
 * sketch id that is not a uuid resolves to nothing at all.
 *
 * These are deliberately NOT in data/image-refs. A drawer is a person's
 * standing likeness; a sketch is one gesture for one picture, and putting them
 * in the same place would make every sketch a permanent reference for whoever
 * owned the folder it landed in.
 */
import crypto from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { PROJECT_ROOT } from '../config.js';

export const SKETCH_DIR = join(PROJECT_ROOT, 'data', 'sketches');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only a uuid is a sketch id. Everything else — paths, traversal, empties. */
export function isSketchId(value: unknown): boolean {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * The bytes of a `data:image/png;base64,...` URL, or null.
 *
 * The canvas hands over a data URL and that is the only shape accepted: an
 * http(s) URL here would make the server fetch whatever the client named.
 */
export function decodeSketchDataUrl(dataUrl: unknown): Buffer | null {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  try {
    const buf = Buffer.from(match[2], 'base64');
    // A canvas PNG is never this small, and never larger than a phone screen's
    // worth of pixels. Both bounds are about refusing something that is not a
    // sketch rather than about disk.
    if (buf.length < 64 || buf.length > 12 * 1024 * 1024) return null;
    return buf;
  } catch {
    return null;
  }
}

export function saveSketch(buffer: Buffer): string {
  mkdirSync(SKETCH_DIR, { recursive: true });
  const id = crypto.randomUUID();
  writeFileSync(join(SKETCH_DIR, `${id}.png`), buffer);
  return id;
}

/** The path a sketch id names, or null. The ONLY id-to-path door. */
export function sketchPath(id: unknown): string | null {
  if (!isSketchId(id)) return null;
  const path = join(SKETCH_DIR, `${id}.png`);
  return existsSync(path) ? path : null;
}

/** Every usable path in a list of ids, skipping anything that is not one. */
export function sketchPaths(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  for (const id of ids.slice(0, 4)) {
    const path = sketchPath(id);
    if (path) out.push(path);
  }
  return out;
}

/**
 * Drop sketches older than a day. A sketch is scaffolding for one picture, and
 * without this the folder grows forever with drawings nobody will look at
 * again. Runs on upload rather than on a timer: the only moment this directory
 * is guaranteed to matter is when something is being added to it.
 */
export function pruneSketches(maxAgeMs = 24 * 60 * 60 * 1000, now = Date.now()): void {
  try {
    for (const name of readdirSync(SKETCH_DIR)) {
      if (!name.endsWith('.png')) continue;
      const path = join(SKETCH_DIR, name);
      try {
        if (now - statSync(path).mtimeMs > maxAgeMs) unlinkSync(path);
      } catch { /* a file that vanished under us needs no handling */ }
    }
  } catch { /* no directory yet is the same as nothing to prune */ }
}
