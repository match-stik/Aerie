// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { normalizePhotoAdjustments } from './photo-adjustments';
import type { EdgePresetId, PhotoAdjustmentStackV1 } from './types';

interface PhotoRenderRequest {
  adjustments: PhotoAdjustmentStackV1 | undefined;
  edgePreset: EdgePresetId;
  seed: number;
  maxDimension: number;
  format: 'preview' | 'final';
}

export interface PhotoRenderResult {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
}

interface PhotoWorkerResponse extends Partial<PhotoRenderResult> {
  id: string;
  ok: boolean;
  error?: string;
}

interface ActiveRender {
  id: string;
  reject: (error: Error) => void;
}

function cancelledError(): Error {
  return new DOMException('A newer darkroom preview replaced this one.', 'AbortError');
}

/**
 * One renderer belongs to one open Photo Lab session. A completed render keeps
 * the decoded source warm in its worker. A newer request terminates active
 * work rather than allowing an old slider position to flash over the latest.
 */
export class PressPhotoRenderer {
  private worker: Worker | null = null;
  private workerHasSource = false;
  private active: ActiveRender | null = null;

  constructor(
    private readonly sourceKey: string,
    private readonly source: Blob,
  ) {}

  private resetWorker(cancelActive: boolean): Worker {
    if (cancelActive && this.active) this.active.reject(cancelledError());
    this.active = null;
    this.worker?.terminate();
    this.worker = new Worker(new URL('./press-image.worker.ts', import.meta.url), { type: 'module' });
    this.workerHasSource = false;
    return this.worker;
  }

  render(request: PhotoRenderRequest): Promise<PhotoRenderResult> {
    const worker = this.active
      ? this.resetWorker(true)
      : this.worker || this.resetWorker(false);
    const id = crypto.randomUUID();
    return new Promise<PhotoRenderResult>((resolve, reject) => {
      this.active = { id, reject };
      worker.onerror = (event) => {
        if (this.active?.id !== id) return;
        this.active = null;
        this.workerHasSource = false;
        reject(new Error(event.message || 'The darkroom worker stopped unexpectedly.'));
      };
      worker.onmessage = (event: MessageEvent<PhotoWorkerResponse>) => {
        if (event.data.id !== id || this.active?.id !== id) return;
        this.active = null;
        if (!event.data.ok || !event.data.blob || !event.data.width || !event.data.height) {
          this.workerHasSource = false;
          reject(new Error(event.data.error || 'The darkroom could not render that photo.'));
          return;
        }
        this.workerHasSource = true;
        resolve({
          blob: event.data.blob,
          width: event.data.width,
          height: event.data.height,
          mimeType: event.data.mimeType || event.data.blob.type,
        });
      };
      worker.postMessage({
        id,
        sourceKey: this.sourceKey,
        source: this.workerHasSource ? undefined : this.source,
        adjustments: normalizePhotoAdjustments(request.adjustments),
        edgePreset: request.edgePreset,
        seed: request.seed,
        maxDimension: request.maxDimension,
        mimeType: request.format === 'preview' ? 'image/webp' : 'image/png',
        quality: request.format === 'preview' ? 0.86 : 1,
      });
    });
  }

  close(): void {
    if (this.active) this.active.reject(cancelledError());
    this.active = null;
    this.worker?.terminate();
    this.worker = null;
    this.workerHasSource = false;
  }
}

export function isCancelledPhotoRender(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
