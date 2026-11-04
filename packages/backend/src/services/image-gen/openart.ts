// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { promises as fs } from 'fs';
import { join, extname, basename } from 'path';
import { GALLERY_DIR, IMAGE_EXTS, VIDEO_EXTS, codexHome, getImageGenSettings } from './settings.js';
import { GenerateInput, GenerateResult, ImageGenError, MAX_REFS_PER_SUBJECT, newGalleryName, resolveAllRefs, resolveSize } from './common.js';

/** OpenArt model ids that produce video. kling-3-omni does both; the
 *  request's openartMedia decides which mode family it runs in. */
const OPENART_VIDEO_ONLY = new Set([
  'grok-imagine-1-5', 'gemini-omni-flash', 'wan2-7', 'pixverseV6',
  'byte-plus-seedance-2', 'byte-plus-seedance-2-fast', 'byte-plus-seedance-2-mini',
]);

/** Models whose only video mode is image2video (no element/text modes). */
const OPENART_I2V_ONLY = new Set(['grok-imagine-1-5']);
/** Models without element2video — fall back to image2video when refs exist. */
const OPENART_NO_ELEMENT = new Set(['pixverseV6', 'grok-imagine-1-5']);

function openartMode(media: 'image' | 'video', model: string, hasRefs: boolean): string {
  if (media === 'image') return hasRefs ? 'image2image' : 'text2image';
  if (OPENART_I2V_ONLY.has(model)) return 'image2video';
  if (!hasRefs) return 'text2video';
  return OPENART_NO_ELEMENT.has(model) ? 'image2video' : 'element2video';
}

function contentTypeFor(file: string): string {
  const ext = extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

interface OpenArtCredEntry {
  server_url: string;
  client_id: string;
  access_token: string;
  expires_at: number;
  refresh_token: string;
}

/** Load the OpenArt bearer token from codex's credential store, refreshing
 *  it in place when it is about to expire. */
async function openartAuth(): Promise<{ url: string; token: string }> {
  const credFile = join(codexHome(), '.credentials.json');
  let creds: Record<string, OpenArtCredEntry>;
  try {
    creds = JSON.parse(await fs.readFile(credFile, 'utf8'));
  } catch {
    throw new ImageGenError('OpenArt is not logged in — run `codex mcp login openart` first.');
  }
  const key = Object.keys(creds).find((k) => k.startsWith('openart|'));
  if (!key) throw new ImageGenError('OpenArt is not logged in — run `codex mcp login openart` first.');
  const entry = creds[key];
  if (Number(entry.expires_at) < Date.now() + 60_000) {
    const resp = await fetch('https://openart.ai/suite/api/auth/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: entry.refresh_token,
        client_id: entry.client_id,
      }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      throw new ImageGenError(`OpenArt token refresh failed (${resp.status}) — re-run \`codex mcp login openart\`.`);
    }
    const t = await resp.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    entry.access_token = t.access_token;
    if (t.refresh_token) entry.refresh_token = t.refresh_token;
    entry.expires_at = Date.now() + (t.expires_in ? t.expires_in * 1000 : 3600_000);
    creds[key] = entry;
    await fs.writeFile(credFile, JSON.stringify(creds, null, 2));
  }
  return { url: entry.server_url || 'https://mcp.openart.ai/mcp', token: entry.access_token };
}

/** One MCP tools/call round-trip; returns the joined text content. */
async function openartCall(name: string, args: Record<string, unknown>): Promise<string> {
  const { url, token } = await openartAuth();
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!resp.ok) throw new ImageGenError(`OpenArt MCP ${name}: HTTP ${resp.status}.`);
  let raw = await resp.text();
  for (const line of raw.split('\n')) {
    if (line.startsWith('data:')) { raw = line.slice(5); break; }
  }
  const parsed = JSON.parse(raw) as {
    error?: { message?: string };
    result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  };
  if (parsed.error) throw new ImageGenError(`OpenArt ${name}: ${parsed.error.message || 'MCP error'}`);
  const text = (parsed.result?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
  if (parsed.result?.isError) throw new ImageGenError(`OpenArt ${name}: ${text.slice(0, 300)}`);
  return text;
}

/** Tool replies mix a JSON payload with prose instructions; dig the JSON out. */
function parseFirstJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { /* fall through to per-line */ }
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { return JSON.parse(t); } catch { /* keep looking */ }
  }
  return null;
}

/** Flatten a model form's jsonSchema (allOf layers) into properties + required.
 *  Some forms route property schemas through $defs — resolve one $ref level. */
function collectFormProps(form: Record<string, unknown> | null, mode: string): {
  props: Record<string, Record<string, unknown>>;
  required: Set<string>;
} {
  const props: Record<string, Record<string, unknown>> = {};
  const required = new Set<string>();
  type SchemaNode = Record<string, unknown>;
  const schema = form?.jsonSchema as SchemaNode | undefined;
  const defs = schema?.$defs ?? {};
  const resolve = (value: SchemaNode): SchemaNode => {
    let node = value;
    const seen = new Set<string>();
    while (typeof node?.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
      const key = node.$ref.slice('#/$defs/'.length);
      if (seen.has(key)) break;
      seen.add(key);
      const next = defs[key];
      if (!next || typeof next !== 'object') break;
      node = next as SchemaNode;
    }
    return node;
  };

  // OpenArt's element-video forms are frequently discriminated unions rather
  // than flat objects. Pick the element + single-shot branch instead of
  // merging mutually exclusive branches (which produces an impossible form).
  const desiredCreationMode = mode === 'element2video' ? 'element' : 'text';
  const branchScore = (value: SchemaNode): number => {
    const node = resolve(value);
    const p = (node.properties ?? {}) as Record<string, SchemaNode>;
    let score = 0;
    const creation = p.creationMode ? resolve(p.creationMode).const : undefined;
    if (creation === desiredCreationMode) score += 100;
    else if (creation !== undefined) score -= 100;
    const multiShot = p.multiShot ? resolve(p.multiShot).const : undefined;
    if (multiShot === false) score += 10;
    else if (multiShot === true) score -= 10;
    return score;
  };
  const visit = (value: SchemaNode): void => {
    const node = resolve(value);
    const nodeProps = (node.properties ?? {}) as Record<string, SchemaNode>;
    for (const [name, prop] of Object.entries(nodeProps)) props[name] = resolve(prop);
    for (const name of (node.required ?? []) as string[]) required.add(name);
    for (const child of (node.allOf ?? []) as SchemaNode[]) visit(child);
    const variants = ((node.oneOf ?? node.anyOf) ?? []) as SchemaNode[];
    if (variants.length) {
      const selected = variants.reduce((best, candidate) =>
        branchScore(candidate) > branchScore(best) ? candidate : best,
      );
      visit(selected);
    }
  };
  if (schema) visit(schema);
  return { props, required };
}

/** Pick the enum aspect ratio closest to the requested pixel size. */
export function closestAspect(options: unknown, apiSize: string): string {
  const opts = Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string') : [];
  if (!opts.length) return '1:1';
  const [w, h] = apiSize.split('x').map(Number);
  const target = w && h ? w / h : 1;
  let best = opts[0];
  let bestDiff = Infinity;
  for (const opt of opts) {
    const [ow, oh] = opt.split(':').map(Number);
    if (!ow || !oh) continue;
    const diff = Math.abs(ow / oh - target);
    if (diff < bestDiff) { bestDiff = diff; best = opt; }
  }
  return best;
}

export async function generateViaOpenArt(input: GenerateInput): Promise<GenerateResult> {
  const start = Date.now();
  const settings = getImageGenSettings();
  const model = input.openartModel || settings.openartModel;
  const media: 'image' | 'video' =
    input.openartMedia || (OPENART_VIDEO_ONLY.has(model) ? 'video' : 'image');
  // A video model needs one distinct element per selected subject, not two
  // alternate portraits of the same subject. Sending both drawer images made
  // Seedance treat one person as two visual elements (and sometimes reject
  // visualRef outright); it also let I2V models choose the weaker likeness as
  // their opening frame.
  const refs = await resolveAllRefs(input, media === 'video' ? 1 : MAX_REFS_PER_SUBJECT);
  if (OPENART_I2V_ONLY.has(model) && refs.length === 0) {
    throw new ImageGenError(`${model} is image-to-video only — select at least one reference subject.`);
  }
  const mode = openartMode(media, model, refs.length > 0);
  const { apiSize } = resolveSize(input);

  // Upload each reference ourselves: sign, PUT the bytes, keep the handle.
  const visualReferences: Array<Record<string, unknown>> = [];
  for (const ref of refs) {
    const bytes = await fs.readFile(ref);
    const ct = contentTypeFor(ref);
    const sign = parseFirstJson(await openartCall('openart_upload_sign', {
      mediaType: 'image', size: bytes.length, contentType: ct, purpose: `create-${media}`,
    })) as { uploadId?: string; signURL?: string; accessURL?: string } | null;
    if (!sign?.signURL || !sign.uploadId) throw new ImageGenError('OpenArt upload_sign returned no signed URL.');
    const put = await fetch(sign.signURL, {
      method: 'PUT',
      headers: { 'Content-Type': ct },
      body: bytes,
      signal: AbortSignal.timeout(300_000),
    });
    if (!put.ok) throw new ImageGenError(`OpenArt reference upload failed (${put.status}).`);
    let visualReference: Record<string, unknown> = {
      type: 'image', id: sign.uploadId, url: sign.accessURL,
      label: basename(ref),
    };
    // Element-video adapters (notably Seedance and Kling) validate the source
    // dimensions and file size even though some published schemas do not mark
    // metadata required. Ask OpenArt to probe the completed upload and use its
    // canonical reference object. I2V startFrame is narrowed back to four
    // fields below because Grok explicitly forbids metadata there.
    if (media === 'video') {
      let probed: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 5 && !probed; attempt++) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, 1_000));
        try {
          const metadata = parseFirstJson(await openartCall('openart_upload_metadata_get', {
            mediaType: 'image', mediaUrl: sign.accessURL,
            uploadId: sign.uploadId, label: basename(ref),
          }));
          const candidate = metadata?.visualReference;
          if (candidate && typeof candidate === 'object') probed = candidate as Record<string, unknown>;
        } catch { /* the freshly uploaded asset may still be processing */ }
      }
      if (!probed) throw new ImageGenError('OpenArt could not read the uploaded reference metadata.');
      visualReference = probed;
    }
    visualReferences.push(visualReference);
  }

  // Ask the form what this model/mode takes and fill it deterministically.
  const form = parseFirstJson(await openartCall('openart_model_form_get', { model, mode }));
  const { props, required } = collectFormProps(form, mode);
  const params: Record<string, unknown> = { prompt: input.prompt };
  if (props.imageCount) params.imageCount = 1;
  if (props.aspectRatio) params.aspectRatio = closestAspect(props.aspectRatio.enum, apiSize);
  if (props.visualReferences) {
    if (visualReferences.length) params.visualReferences = visualReferences;
    else if (required.has('visualReferences')) params.visualReferences = [];
  }
  // image2video forms take a single startFrame object with a strict shape
  // ({type,id,url,label} only — additionalProperties:false rejects extras).
  if (props.startFrame && visualReferences.length) {
    const first = visualReferences[0];
    params.startFrame = { type: 'image', id: first.id, url: first.url, label: 'start frame' };
  }
  const formDefaults = (form?.defaults ?? {}) as Record<string, unknown>;
  for (const [name, schema] of Object.entries(props)) {
    if (name in params || !required.has(name)) continue;
    if ('default' in schema) params[name] = schema.default;
    else if (name in formDefaults) params[name] = formDefaults[name];
    else if ('const' in schema) params[name] = schema.const;
    else if (Array.isArray(schema.enum) && schema.enum.length) params[name] = schema.enum[0];
  }

  const timeoutMs = media === 'video' ? 900_000 : 480_000;
  const genText = await openartCall(
    media === 'video' ? 'openart_generate_video' : 'openart_generate_image',
    { model, mode, params },
  );
  const gen = parseFirstJson(genText) as { status?: string; historyId?: string; error?: string } | null;
  if (!gen?.historyId || gen.historyId === 'submit-failed' || gen.status === 'FAILED') {
    throw new ImageGenError(`OpenArt rejected the generation: ${gen?.error || genText.slice(0, 300)}`);
  }

  interface WaitStatus { status?: string; error?: string; resources?: Array<{ url?: string }> }
  let done: WaitStatus | null = null;
  let blanks = 0;
  while (Date.now() - start < timeoutMs) {
    const w = parseFirstJson(await openartCall('openart_creation_wait', {
      historyId: gen.historyId, timeoutSeconds: 90,
    })) as WaitStatus | null;
    if (!w) {
      if (++blanks >= 3) throw new ImageGenError('OpenArt stopped returning parseable status.');
      continue;
    }
    blanks = 0;
    if (w.status === 'COMPLETED') { done = w; break; }
    if (w.status === 'FAILED' || w.status === 'CANCELLED') {
      throw new ImageGenError(`OpenArt generation ${w.status.toLowerCase()}: ${w.error || 'no reason given'}`);
    }
  }
  if (!done) throw new ImageGenError(`OpenArt generation timed out (${Math.round(timeoutMs / 60000)} min).`);
  const url = done.resources?.[0]?.url;
  if (!url) throw new ImageGenError('OpenArt finished but returned no resource URL.');

  const resp = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!resp.ok) throw new ImageGenError(`Could not download OpenArt result (${resp.status}).`);
  const buf = Buffer.from(await resp.arrayBuffer());

  const urlExt = extname(new URL(url).pathname).toLowerCase();
  const ext = (media === 'video')
    ? (VIDEO_EXTS.has(urlExt) ? urlExt : '.mp4')
    : (IMAGE_EXTS.has(urlExt) ? urlExt : '.png');
  const filename = await newGalleryName(ext, media === 'video' ? 'vid' : 'img');
  const dest = join(GALLERY_DIR, filename);
  await fs.writeFile(dest, buf);

  return {
    filename,
    path: dest,
    backend: 'openart',
    model,
    mediaType: media,
    durationMs: Date.now() - start,
    costUsd: 0,
  };
}
