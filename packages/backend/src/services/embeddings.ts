// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Semantic embedding service — local all-MiniLM-L6-v2, run directly on
// onnxruntime-node. Lazy-loads the model on first use. No external API calls.
//
// This used to go through @huggingface/transformers. That package is a
// general-purpose toolkit — text, images, audio — and hard-pins an old `sharp`
// for image decoding, which we never touch and which carried open CVEs we could
// not move off. onnxruntime-node was already in the tree as that package's own
// inference engine, so talking to it directly removes a dependency instead of
// trading one for another. The tokenizing lives in ./embeddings/bert-tokenizer.
//
// The weights live in data/models/, NOT in node_modules — the old cache sat
// inside the installed-packages folder, which is rebuilt from scratch on any
// dependency change. Nothing had swept it yet; that was luck, not design.
// The tokenizer is checked in beside the code instead, so a fresh clone can run
// the tokenizer test without a network.

import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import * as ort from 'onnxruntime-node';
import { PROJECT_ROOT } from '../config.js';
import { configFromTokenizerJson, encode, type WordPieceConfig } from './embeddings/bert-tokenizer.js';

const MODEL_ID = 'sentence-transformers/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;
/** Matches the reference pipeline's truncation for this model. */
const MAX_LENGTH = 512;

const MODEL_DIR = join(PROJECT_ROOT, 'data', 'models', 'all-MiniLM-L6-v2');
const MODEL_FILE = join(MODEL_DIR, 'model.onnx');

/**
 * The tokenizer is checked in; only the 90MB of weights are fetched.
 *
 * It is small (~450KB) and it is the half that has to agree with every vector
 * already stored, so a fresh clone should not be able to start without it, and
 * its test should not need a download to run.
 */
export const TOKENIZER_FILE = join(PROJECT_ROOT, 'packages', 'backend', 'assets', 'all-MiniLM-L6-v2-tokenizer.json');

/** Fresh-clone fallback: the weights are gitignored, so fetch them once. */
const REMOTE_FILES: Record<string, string> = {
  [MODEL_FILE]: `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/model.onnx`,
};

interface Loaded {
  session: ort.InferenceSession;
  tokenizer: WordPieceConfig;
}

let loaded: Loaded | null = null;
let loadingPromise: Promise<Loaded> | null = null;

async function ensureFile(path: string): Promise<void> {
  if (existsSync(path)) return;
  const url = REMOTE_FILES[path];
  if (!url) throw new Error(`[embeddings] missing model file with no source: ${path}`);
  mkdirSync(MODEL_DIR, { recursive: true });
  console.log(`[embeddings] Fetching ${url}…`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`[embeddings] download failed (${res.status}) for ${url}`);
  const tmp = `${path}.partial`;
  await streamPipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  const { rename } = await import('node:fs/promises');
  await rename(tmp, path);
}

async function getLoaded(): Promise<Loaded> {
  if (loaded) return loaded;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    await ensureFile(MODEL_FILE);
    console.log('[embeddings] Loading model…');
    const tokenizer = configFromTokenizerJson(JSON.parse(await readFile(TOKENIZER_FILE, 'utf8')));
    const session = await ort.InferenceSession.create(MODEL_FILE);
    console.log('[embeddings] Model loaded.');
    loaded = { session, tokenizer };
    return loaded;
  })();

  try {
    return await loadingPromise;
  } catch (err) {
    loadingPromise = null; // a failed load must not poison every later call
    throw err;
  }
}

/** Generate a 384-dim embedding for a text string. */
export async function embed(text: string): Promise<Float32Array> {
  const { session, tokenizer } = await getLoaded();
  // Truncate very long text to ~first 2000 chars (well within the token limit)
  const truncated = text.length > 2000 ? text.slice(0, 2000) : text;
  const { inputIds, attentionMask, tokenTypeIds } = encode(truncated, tokenizer, MAX_LENGTH);
  const len = inputIds.length;
  const dims = [1, len];
  const big = (xs: number[]) => BigInt64Array.from(xs, BigInt);

  const output = await session.run({
    input_ids: new ort.Tensor('int64', big(inputIds), dims),
    attention_mask: new ort.Tensor('int64', big(attentionMask), dims),
    token_type_ids: new ort.Tensor('int64', big(tokenTypeIds), dims),
  });

  const hidden = output.last_hidden_state.data as Float32Array;

  // Mean pooling over unmasked tokens, then L2 normalize.
  const pooled = new Float32Array(EMBEDDING_DIM);
  let counted = 0;
  for (let t = 0; t < len; t++) {
    if (!attentionMask[t]) continue;
    counted++;
    const offset = t * EMBEDDING_DIM;
    for (let i = 0; i < EMBEDDING_DIM; i++) pooled[i] += hidden[offset + i];
  }
  if (counted > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) pooled[i] /= counted;
  }
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += pooled[i] * pooled[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) pooled[i] /= norm;
  }
  return pooled;
}

/** Cosine similarity between two normalized vectors (dot product since L2-normalized). */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/** Convert Float32Array to Buffer for SQLite storage. */
export function vectorToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/** Convert Buffer back to Float32Array. */
export function bufferToVector(b: Buffer): Float32Array {
  const arrayBuffer = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Float32Array(arrayBuffer);
}

export { EMBEDDING_DIM };
