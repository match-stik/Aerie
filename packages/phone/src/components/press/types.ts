// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

export type EdgePresetId = 'clean' | 'soft-tear' | 'deckled' | 'ripped-corners' | 'scalloped';
export type BorderPresetId = 'ink' | 'stitched' | 'instant-film';
export type TapePresetId = 'masking' | 'vellum' | 'paper' | 'repair';

export type PhotoAdjustmentType =
  | 'exposure'
  | 'contrast'
  | 'temperature'
  | 'tint'
  | 'saturation'
  | 'vibrance'
  | 'black-white';

export interface PhotoAdjustmentV1 {
  id: string;
  type: PhotoAdjustmentType;
  enabled: boolean;
  value: number;
}

export interface PhotoAdjustmentStackV1 {
  version: 1;
  items: PhotoAdjustmentV1[];
}

export const PRESS_WORKSPACE_COLOR = '#09090b';
export const PRESS_PAPER_COLOR = '#fffaf0';

export interface PhotoMaterialRecipe {
  kind: 'photo';
  assetId: string;
  sourceFileId: string;
  renderedFileId: string;
  edgePreset: EdgePresetId;
  seed: number;
  adjustments?: PhotoAdjustmentStackV1;
}

export interface TapeMaterialRecipe {
  kind: 'tape';
  preset: TapePresetId;
  color: string;
  seed: number;
}

export interface BorderMaterialRecipe {
  kind: 'border';
  preset: BorderPresetId;
  targetId: string;
}

export interface PackItemMaterialRecipe {
  kind: 'pack-item';
  packId: string;
  itemId: string;
}

export type PressMaterialRecipe = PhotoMaterialRecipe | TapeMaterialRecipe | BorderMaterialRecipe | PackItemMaterialRecipe;

export interface PressFileRef {
  id: string;
  kind: 'photo' | 'material' | 'pack';
  mimeType: string;
  storageFileId?: string;
  sourceFileId?: string;
  assetId?: string;
  inlineDataURL?: string;
  recipe?: PressMaterialRecipe;
}

export interface PressSceneDocumentV1 {
  version: 1;
  page: {
    x: number;
    y: number;
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

export interface UploadedFile {
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  contentType: 'image' | 'audio' | 'file';
  url: string;
}

export function createEmptyScene(width: number, height: number): PressSceneDocumentV1 {
  return {
    version: 1,
    page: { x: 0, y: 0, width, height, background: PRESS_PAPER_COLOR },
    elements: [],
    appState: { viewBackgroundColor: PRESS_WORKSPACE_COLOR },
    files: {},
  };
}

export function parsePressScene(raw: string, width: number, height: number): PressSceneDocumentV1 {
  try {
    const value = JSON.parse(raw) as Partial<PressSceneDocumentV1>;
    if (value?.version !== 1) return createEmptyScene(width, height);
    const elements = Array.isArray(value.elements) ? value.elements : [];
    const pageWidth = Number(value.page?.width) || width;
    const pageHeight = Number(value.page?.height) || height;
    const storedX = Number(value.page?.x);
    const storedY = Number(value.page?.y);
    const hasStoredOrigin = Number.isFinite(storedX) && Number.isFinite(storedY);

    // Early Press spreads did not persist the paper origin. A full-page frame
    // could therefore keep its real coordinates while the synthetic paper was
    // rebuilt at 0,0. Recover that one unambiguous legacy case so the paper,
    // frame, and everything clipped inside it line up again.
    const matchingFrames = hasStoredOrigin ? [] : elements.filter((element) => (
      !element.isDeleted
      && element.type === 'frame'
      && Math.abs(element.width - pageWidth) <= Math.max(1, pageWidth * 0.001)
      && Math.abs(element.height - pageHeight) <= Math.max(1, pageHeight * 0.001)
    ));
    const inferredFrame = matchingFrames.length === 1 ? matchingFrames[0] : null;
    const existingPage = elements.find((element) => (
      (element.customData as { press?: { kind?: string } } | undefined)?.press?.kind === 'page'
    ));
    const pageX = hasStoredOrigin
      ? storedX
      : inferredFrame?.x ?? (Number.isFinite(existingPage?.x) ? existingPage!.x : 0);
    const pageY = hasStoredOrigin
      ? storedY
      : inferredFrame?.y ?? (Number.isFinite(existingPage?.y) ? existingPage!.y : 0);

    return {
      version: 1,
      page: {
        x: pageX,
        y: pageY,
        width: pageWidth,
        height: pageHeight,
        background: value.page?.background === '#f3ead9'
          ? PRESS_PAPER_COLOR
          : value.page?.background || PRESS_PAPER_COLOR,
      },
      elements,
      appState: {
        viewBackgroundColor: value.appState?.viewBackgroundColor === '#d8d0c4'
          ? PRESS_WORKSPACE_COLOR
          : value.appState?.viewBackgroundColor || PRESS_WORKSPACE_COLOR,
        gridSize: value.appState?.gridSize ?? null,
      },
      files: value.files && typeof value.files === 'object' ? value.files : {},
    };
  } catch {
    return createEmptyScene(width, height);
  }
}
