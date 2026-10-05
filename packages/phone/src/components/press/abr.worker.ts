// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { parseAbr } from './abr-parser';

interface AbrWorkerRequest {
  id: string;
  buffer: ArrayBuffer;
  baseName: string;
}

self.onmessage = (event: MessageEvent<AbrWorkerRequest>) => {
  const { id, buffer, baseName } = event.data;
  try {
    const result = parseAbr(buffer, baseName);
    const transfers = result.brushes.map((brush) => brush.coverage.buffer);
    self.postMessage({ id, ok: true, result }, { transfer: transfers });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Could not read that ABR file.',
    });
  }
};

