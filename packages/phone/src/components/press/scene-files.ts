// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Turning a stored Press scene's file references into the pictures Excalidraw draws
// with. Shared by the editor, which opens a page, and the shelf painter, which paints
// a page's shelf picture without opening it.
import type { BinaryFileData, BinaryFiles, DataURL } from '@excalidraw/excalidraw/types';
import type { FileId } from '@excalidraw/excalidraw/element/types';
import { apiFetch } from '../../aerie';
import type { PressFileRef } from './types';

export function fileToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(blob);
  });
}

export async function hydrateFiles(refs: Record<string, PressFileRef>): Promise<BinaryFiles> {
  const entries = await Promise.all(Object.entries(refs).map(async ([id, ref]) => {
    try {
      let dataURL = ref.inlineDataURL;
      if (!dataURL && ref.storageFileId) {
        const response = await apiFetch(`/api/files/${ref.storageFileId}`);
        if (!response.ok) return null;
        dataURL = await fileToDataURL(await response.blob());
      }
      if (!dataURL) return null;
      const file: BinaryFileData = {
        id: id as FileId,
        dataURL: dataURL as DataURL,
        mimeType: ref.mimeType as BinaryFileData['mimeType'],
        created: Date.now(),
        lastRetrieved: Date.now(),
      };
      return [id, file] as const;
    } catch {
      return null;
    }
  }));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, BinaryFileData] => !!entry)) as BinaryFiles;
}
