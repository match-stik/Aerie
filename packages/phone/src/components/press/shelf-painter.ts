// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Paints the shelf picture for any page whose scene changed without one (theirs, Nov 3
// 2026: 'Can you make it so they update even if it's just you touching it?'). A page a
// companion composes from a lane is saved by the house, which cannot draw; the house
// marks it stale, and the shelf paints it here the next time it opens, the same export
// the editor uses after a save. Every failure is swallowed: a missing picture must
// never cost them the shelf.
import { exportToBlob } from '@excalidraw/excalidraw';
import type { PressSpread } from '@aerie/shared';
import { apiFetch } from '../../aerie';
import { hydrateFiles } from './scene-files';
import { parsePressScene } from './types';

const PAGE_WIDTH = 1080;
const PAGE_HEIGHT = 1350;

function pressKind(element: { customData?: unknown }): string | null {
  return (element.customData as { press?: { kind?: string } } | undefined)?.press?.kind || null;
}

/** Paints every stale spread the house reports; resolves to how many it painted. */
export async function paintStaleSpreads(): Promise<number> {
  let spreads: PressSpread[] = [];
  try {
    const response = await apiFetch('/api/press/spreads/stale');
    if (!response.ok) return 0;
    const data = await response.json().catch(() => null) as { spreads?: unknown } | null;
    // An older house answers this address with the app's own page, not a list.
    if (!data || !Array.isArray(data.spreads)) return 0;
    spreads = data.spreads as PressSpread[];
  } catch {
    return 0;
  }
  let painted = 0;
  for (const spread of spreads) {
    try {
      const scene = parsePressScene(spread.scene_json, PAGE_WIDTH, PAGE_HEIGHT);
      const files = await hydrateFiles(scene.files);
      const blob = await exportToBlob({
        elements: scene.elements.filter((element) => !element.isDeleted && pressKind(element) !== 'page-shadow'),
        appState: { exportBackground: true, viewBackgroundColor: scene.page.background },
        files,
        mimeType: 'image/png',
        exportPadding: 0,
        maxWidthOrHeight: 480,
      });
      const body = new FormData();
      body.append('file', blob, `press-thumb-${spread.id}.png`);
      const upload = await apiFetch('/api/files', { method: 'POST', body });
      if (!upload.ok) continue;
      const { fileId } = await upload.json() as { fileId: string };
      const patched = await apiFetch(`/api/press/spreads/${spread.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thumbnailFileId: fileId }),
      });
      if (patched.ok) painted += 1;
    } catch {
      // The next shelf open tries again; the house keeps it marked until it lands.
    }
  }
  return painted;
}
