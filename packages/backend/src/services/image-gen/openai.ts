// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { getConfig } from '../db/config.js';
import { GALLERY_DIR, getImageGenSettings } from './settings.js';
import { GenerateInput, GenerateResult, ImageGenError, newGalleryName, resolveAllRefs, resolveSize } from './common.js';

function estimateOpenAiCost(size: string): number {
  if (size === '1024x1024') return 0.07;
  return 0.1;
}

export async function generateViaOpenAi(input: GenerateInput): Promise<GenerateResult> {
  const start = Date.now();
  const key = getConfig('image_gen.openai_api_key');
  if (!key) throw new ImageGenError('OpenAI backend selected but no API key is set in Studio settings.');
  const { openaiModel: model, quality } = getImageGenSettings();
  const { apiSize } = resolveSize(input);
  const refs = await resolveAllRefs(input);

  let b64: string | undefined;
  if (refs.length > 0) {
    const form = new FormData();
    form.set('model', model);
    form.set('prompt', input.prompt);
    form.set('size', apiSize);
    if (quality !== 'auto') form.set('quality', quality);
    for (const r of refs.slice(0, 4)) {
      const buf = await fs.readFile(r);
      form.append('image[]', new Blob([buf]), basename(r));
    }
    const resp = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    const data = (await resp.json()) as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    if (!resp.ok) throw new ImageGenError(`OpenAI edits failed: ${data.error?.message || resp.status}`);
    b64 = data.data?.[0]?.b64_json;
  } else {
    const genBody: Record<string, unknown> = { model, prompt: input.prompt, size: apiSize, n: 1 };
    if (quality !== 'auto') genBody.quality = quality;
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(genBody),
      signal: AbortSignal.timeout(180_000),
    });
    const data = (await resp.json()) as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    if (!resp.ok) throw new ImageGenError(`OpenAI generation failed: ${data.error?.message || resp.status}`);
    b64 = data.data?.[0]?.b64_json;
  }

  if (!b64) throw new ImageGenError('OpenAI returned no image data.');
  const filename = await newGalleryName();
  const dest = join(GALLERY_DIR, filename);
  await fs.writeFile(dest, Buffer.from(b64, 'base64'));

  return {
    filename,
    path: dest,
    backend: 'openai',
    model,
    durationMs: Date.now() - start,
    costUsd: estimateOpenAiCost(apiSize),
  };
}
