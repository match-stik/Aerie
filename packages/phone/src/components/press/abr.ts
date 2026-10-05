// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { AbrBrushTip, AbrImportResult } from './abr-parser';

interface AbrWorkerResponse {
  id: string;
  ok: boolean;
  result?: AbrImportResult;
  error?: string;
}

export async function parseAbrInWorker(file: File, baseName: string): Promise<AbrImportResult> {
  const worker = new Worker(new URL('./abr.worker.ts', import.meta.url), { type: 'module' });
  const id = crypto.randomUUID();
  const buffer = await file.arrayBuffer();
  return new Promise<AbrImportResult>((resolve, reject) => {
    const finish = () => worker.terminate();
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'The ABR importer worker stopped unexpectedly.'));
    };
    worker.onmessage = (event: MessageEvent<AbrWorkerResponse>) => {
      if (event.data.id !== id) return;
      finish();
      if (!event.data.ok || !event.data.result) {
        reject(new Error(event.data.error || 'Could not read that ABR file.'));
        return;
      }
      resolve(event.data.result);
    };
    worker.postMessage({ id, buffer, baseName }, [buffer]);
  });
}

export async function abrTipToPng(brush: AbrBrushTip): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = brush.width;
  canvas.height = brush.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for ABR tip rendering.');
  const image = context.createImageData(brush.width, brush.height);
  for (let index = 0; index < brush.coverage.length; index += 1) {
    const pixel = index * 4;
    image.data[pixel] = 18;
    image.data[pixel + 1] = 18;
    image.data[pixel + 2] = 18;
    image.data[pixel + 3] = brush.coverage[index];
  }
  context.putImageData(image, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not render an ABR tip.')), 'image/png');
  });
}
