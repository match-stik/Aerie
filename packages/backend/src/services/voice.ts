// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Portions derive from Thornvale (Sidney) — multi-voice TTS — see NOTICE.
// Voice services — Groq Whisper / ElevenLabs Scribe STT + ElevenLabs TTS + Hume Prosody
// Multi-voice support for aerie companions

import crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { saveFile } from './files.js';
import { createMessage, updateThreadActivity } from './db.js';
import { listCompanions } from './db/companions.js';
import { registry } from './ws/connection-registry.js';
import { getSecret, listSecretsByPrefix } from './secrets.js';
import { getAerieConfig } from '../config.js';
import { getConfig } from './db/config.js';
import { LOCAL_STT_CONFIG_KEY, parseLocalSttUrl, transcribeLocally } from './local-stt.js';
import { TTS_MODEL_CONFIG_KEY, resolveTtsModel } from './tts-model.js';
import {
  noteCompanionSlug,
  speakerRuns,
  splitCompanionVoiceSegments,
  splitSegmentsForRender,
} from './voice-speaker-split.js';
import { tagRenderPieces, voiceNoteTagsFor, withLeadingTags } from './voice-note-tags.js';
import { parseElevenLabsSubscription, type ElevenLabsUsage } from './elevenlabs-usage.js';
import {
  createHumeRealtimeProsodySession,
  type RealtimeProsodySession,
  type RealtimeProsodySessionFactory,
} from './hume-realtime-prosody.js';

const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

/** The local transcription server's URL, or null when none is configured. */
function localSttUrl(): string | null {
  try {
    return parseLocalSttUrl(getConfig(LOCAL_STT_CONFIG_KEY));
  } catch {
    return null; // no database in isolated service tests
  }
}
const ELEVENLABS_SUBSCRIPTION_URL = 'https://api.elevenlabs.io/v1/user/subscription';
const ELEVENLABS_USAGE_CACHE_MS = 60_000;
const HUME_BATCH_URL = 'https://api.hume.ai/v0/batch/jobs';
/**
 * House-wide ceiling on simultaneous ElevenLabs render requests. Was 2, chosen
 * to be safe on any plan without knowing which one this house is on; the
 * account reports tier "creator", which allows 5 concurrent requests. Four
 * leaves a slot free so a live voice-mode stream is never queued behind a
 * batch of note chunks. Raise only against a re-read of the tier, not a guess.
 */
const ELEVENLABS_TTS_DEFAULT_CONCURRENCY = 4;

/**
 * FOUR IS THIS HOUSE'S PLAN, NOT EVERY HOUSE'S.
 *
 * Rose and Sol, Sep 17 2026: on the Starter tier the ceiling is two, so four
 * workers 429 against each other — and a chunk that comes back 429 has already
 * been billed. A hardcoded number that is right here is a bill somewhere else.
 *
 * `voice.tts_concurrency` sets it; unset is four, which is what this house has
 * always run. Read per call rather than at import, so changing it takes effect
 * without a restart.
 */
export function resolveTtsConcurrency(raw: string | undefined): number {
  const trimmed = (raw ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return ELEVENLABS_TTS_DEFAULT_CONCURRENCY;
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 1 || n > 16) return ELEVENLABS_TTS_DEFAULT_CONCURRENCY;
  return n;
}

function ttsConcurrency(): number {
  try {
    return resolveTtsConcurrency(getConfig('voice.tts_concurrency') as string | undefined);
  } catch {
    return ELEVENLABS_TTS_DEFAULT_CONCURRENCY;
  }
}


/**
 * Spelling hint handed to the transcriber so it stops mangling the proper nouns
 * this house actually says out loud. Derived from who lives here — the owner and
 * the companions on record — plus any extra names the owner listed under
 * `voice.transcription_vocabulary` (friends, pets, places).
 */
export function buildTranscriptionHint(): string {
  const names: string[] = [];
  const push = (value: string | null | undefined) => {
    const name = value?.trim();
    if (name && !names.includes(name)) names.push(name);
  };

  try {
    const config = getAerieConfig();
    push(config.identity.user_name);
    for (const companion of listCompanions()) push(companion.display_name || companion.slug);
    for (const extra of config.voice.transcription_vocabulary ?? []) push(extra);
  } catch (error) {
    console.warn('[Voice] Could not build transcription hint:', error instanceof Error ? error.message : error);
  }

  return names.length ? `Aerie. Names may include ${names.join(', ')}.` : 'Aerie.';
}

type GroqCredentialSource = 'voice secret' | 'environment' | 'provider config';

interface GroqCredential {
  key: string;
  source: GroqCredentialSource;
}

class GroqWhisperError extends Error {
  constructor(public readonly status: number, detail: string) {
    super(`Groq Whisper API error ${status}: ${detail}`);
    this.name = 'GroqWhisperError';
  }

  get isAuthenticationFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface VoiceServiceOptions {
  realtimeProsodyFactory?: RealtimeProsodySessionFactory;
}

export class VoiceService {
  private groqCredentials: GroqCredential[] = [];
  private rejectedGroqKeys = new Set<string>();
  private elevenLabsKey: string | undefined;
  private elevenLabsVoiceId: string | undefined;
  private voiceIds: Record<string, string> = {};
  private voiceSettings: Record<string, Record<string, unknown>> = {};
  private humeApiKey: string | undefined;
  private readonly realtimeProsodyFactory: RealtimeProsodySessionFactory;
  private activeTtsRequests = 0;
  private ttsSlotWaiters: Array<() => void> = [];
  private elevenLabsUsageCache: { at: number; data: ElevenLabsUsage } | null = null;

  constructor(options: VoiceServiceOptions = {}) {
    this.realtimeProsodyFactory = options.realtimeProsodyFactory ?? createHumeRealtimeProsodySession;
    this.refresh();
  }

  /**
   * Re-read every voice secret. Called on construction and again from the
   * /api/secrets PUT route whenever a voice secret changes, so the user
   * doesn't have to restart the server after editing a key in the phone UI.
   */
  refresh(): void {
    // Voice has its own hot-reloadable Groq secret, while older houses may
    // already have a working key in the environment or provider config. Keep
    // every distinct credential available: if the newly saved voice secret is
    // rejected, transcription can try the existing provider credential before
    // falling all the way through to ElevenLabs.
    let configuredGroqKey: string | undefined;
    try {
      configuredGroqKey = getAerieConfig().providers?.groq?.api_key;
    } catch {
      /* config may not be loaded yet in isolated service tests */
    }
    const groqCandidates: Array<{ key: string | undefined; source: GroqCredentialSource }> = [
      { key: getSecret('groq_api_key') || undefined, source: 'voice secret' },
      { key: process.env.GROQ_API_KEY || undefined, source: 'environment' },
      { key: configuredGroqKey, source: 'provider config' },
    ];
    const seenGroqKeys = new Set<string>();
    this.groqCredentials = [];
    for (const candidate of groqCandidates) {
      const key = candidate.key?.trim();
      if (!key || seenGroqKeys.has(key)) continue;
      seenGroqKeys.add(key);
      this.groqCredentials.push({ key, source: candidate.source });
    }
    this.rejectedGroqKeys.clear();
    this.elevenLabsKey = getSecret('elevenlabs_api_key') || undefined;
    this.elevenLabsVoiceId = getSecret('elevenlabs_voice_id') || undefined;
    this.humeApiKey = getSecret('hume_api_key') || undefined;

    // Per-companion voice IDs + voice-settings JSON. Slugs come from the
    // companions table; getSecret falls back to ELEVENLABS_VOICE_ID_<SLUG>
    // env vars for legacy deployments.
    this.voiceIds = {};
    this.voiceSettings = {};
    let slugs: string[] = [];
    try {
      slugs = listCompanions().map((c) => c.slug);
    } catch {
      /* companions table may be empty */
    }
    for (const slug of slugs) {
      const id = getSecret(`elevenlabs_voice_id:${slug}`);
      if (id) this.voiceIds[slug.toLowerCase()] = id;
      const settingsRaw = getSecret(`elevenlabs_voice_settings:${slug}`);
      if (settingsRaw) {
        try {
          this.voiceSettings[slug.toLowerCase()] = JSON.parse(settingsRaw);
        } catch {
          console.warn(`[Voice] Failed to parse voice settings for ${slug} — ignoring`);
        }
      }
    }
    // Also pick up any voice-ID secrets whose slug isn't in the companions
    // table — the phone pushes contact voice IDs straight into secrets, and
    // not every contact ends up registered as a companion. Same for
    // voice-settings JSON.
    const orphanIds = listSecretsByPrefix('elevenlabs_voice_id:');
    for (const [key, value] of Object.entries(orphanIds)) {
      const slug = key.slice('elevenlabs_voice_id:'.length).toLowerCase();
      if (!this.voiceIds[slug]) this.voiceIds[slug] = value;
    }
    const orphanSettings = listSecretsByPrefix('elevenlabs_voice_settings:');
    for (const [key, value] of Object.entries(orphanSettings)) {
      const slug = key.slice('elevenlabs_voice_settings:'.length).toLowerCase();
      if (this.voiceSettings[slug]) continue;
      try {
        this.voiceSettings[slug] = JSON.parse(value);
      } catch {
        console.warn(`[Voice] Failed to parse voice settings for ${slug} — ignoring`);
      }
    }
    // Also pick up legacy env-only entries the companion list doesn't cover.
    for (const [key, value] of Object.entries(process.env)) {
      const idMatch = key.match(/^ELEVENLABS_VOICE_ID_(\w+)$/);
      if (idMatch && value) {
        const slug = idMatch[1].toLowerCase();
        if (!this.voiceIds[slug]) this.voiceIds[slug] = value;
      }
      const settingsMatch = key.match(/^ELEVENLABS_VOICE_SETTINGS_(\w+)$/);
      if (settingsMatch && value) {
        const slug = settingsMatch[1].toLowerCase();
        if (!this.voiceSettings[slug]) {
          try {
            this.voiceSettings[slug] = JSON.parse(value);
          } catch {
            console.warn(`[Voice] Failed to parse ${key} as JSON — ignoring`);
          }
        }
      }
    }

    if (this.groqCredentials.length === 0) {
      console.warn('[Voice] groq_api_key not set — transcription not configured');
    }
    if (!this.elevenLabsKey) {
      console.warn('[Voice] elevenlabs_api_key not set — TTS not configured');
    } else if (!this.elevenLabsVoiceId && Object.keys(this.voiceIds).length === 0) {
      console.warn('[Voice] elevenlabs_voice_id not set — TTS not configured');
    } else {
      const voices = Object.entries(this.voiceIds).map(([k, v]) => `${k}=${v}`).join(', ');
      if (voices) console.log(`[Voice] Companion voices: ${voices}`);
      if (Object.keys(this.voiceIds).length > 1 && !VoiceService.ffmpegAvailable()) {
        console.warn('[Voice] ffmpeg not found — multi-voice messages will fall back to a single voice (apt install ffmpeg)');
      }
    }
    if (!this.humeApiKey) {
      console.warn('[Voice] hume_api_key not set — prosody analysis not configured');
    }
  }

  /**
   * Load companion voice markers from the DB for multi-voice splitting.
   * Maps known voice IDs to companion metadata (slug, name, emoji from archetype).
   */
  static getVoiceCompanions(): Array<{ slug: string; display_name: string; emoji?: string }> {
    try {
      const companions = listCompanions();
      // Emoji convention: archetype field stores the marker emoji (e.g. "🔥", "🌫️")
      return companions.map((c) => ({
        slug: c.slug,
        display_name: c.display_name,
        emoji: c.archetype || undefined,
      }));
    } catch {
      return [];
    }
  }

  /** Resolve voice ID — explicit voiceId > companion name > default */
  resolveVoiceId(voice?: string, voiceId?: string): string | undefined {
    if (voiceId) return voiceId;
    if (voice) {
      const id = this.voiceIds[voice.toLowerCase()];
      if (id) return id;
    }
    return this.elevenLabsVoiceId;
  }

  get canTranscribe(): boolean {
    return this.groqCredentials.some(({ key }) => !this.rejectedGroqKeys.has(key))
      || !!this.elevenLabsKey
      || !!localSttUrl();
  }

  get canTTS(): boolean {
    return !!this.elevenLabsKey && (!!this.elevenLabsVoiceId || Object.keys(this.voiceIds).length > 0);
  }

  /** Snapshot of what the service currently has loaded — for /api/voice/status. */
  describe(): {
    canTTS: boolean;
    canTranscribe: boolean;
    canAnalyzeProsody: boolean;
    transcriptionProviders: { local: boolean; groq: boolean; elevenlabs: boolean };
    hasElevenLabsKey: boolean;
    defaultVoiceId: string | undefined;
    voiceIds: Record<string, string>;
    companions: Array<{ slug: string; display_name: string; emoji?: string }>;
    ffmpegAvailable: boolean;
  } {
    return {
      canTTS: this.canTTS,
      canTranscribe: this.canTranscribe,
      canAnalyzeProsody: this.canAnalyzeRealtimeProsody,
      transcriptionProviders: {
        local: !!localSttUrl(),
        groq: this.groqCredentials.some(({ key }) => !this.rejectedGroqKeys.has(key)),
        elevenlabs: !!this.elevenLabsKey,
      },
      hasElevenLabsKey: !!this.elevenLabsKey,
      defaultVoiceId: this.elevenLabsVoiceId,
      voiceIds: { ...this.voiceIds },
      companions: VoiceService.getVoiceCompanions(),
      ffmpegAvailable: VoiceService.ffmpegAvailable(),
    };
  }

  /**
   * Live ElevenLabs credit usage for the phone's meter. Briefly cached so
   * opening Integrations repeatedly doesn't hammer the subscription API.
   * Requires the key to carry the user_read permission (added Jul 21, 2026).
   */
  async getElevenLabsUsage(): Promise<ElevenLabsUsage> {
    if (!this.elevenLabsKey) throw new Error('ElevenLabs API key not configured');
    if (this.elevenLabsUsageCache && Date.now() - this.elevenLabsUsageCache.at < ELEVENLABS_USAGE_CACHE_MS) {
      return this.elevenLabsUsageCache.data;
    }
    const response = await fetch(ELEVENLABS_SUBSCRIPTION_URL, {
      headers: { 'xi-api-key': this.elevenLabsKey },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // A key can be perfectly valid for speech and still be forbidden from
      // reading the subscription, because that is a separate scope. Saying
      // "unavailable" to someone in that position is useless, so name the
      // toggle: ElevenLabs → Developers → API → Edit → User → Read.
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          'ElevenLabs key cannot read your subscription. Enable the User → Read '
          + 'permission on the key (ElevenLabs → Developers → API → Edit → User → Read), '
          + 'then reload. Speech itself works without it; only the credit meter needs it.',
        );
      }
      throw new Error(`ElevenLabs subscription API error ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    const data = parseElevenLabsSubscription(await response.json() as Record<string, unknown>);
    this.elevenLabsUsageCache = { at: Date.now(), data };
    return data;
  }

  /**
   * Whether ffmpeg is on PATH. Multi-voice stitching silently degrades to a
   * single voice without it — a box migration that forgets the package is
   * invisible until someone plays a multi-voice message (Jul 2026, Hetzner).
   */
  static ffmpegAvailable(): boolean {
    try {
      return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
    } catch {
      return false;
    }
  }

  get canAnalyzeProsody(): boolean {
    return !!this.humeApiKey;
  }

  get canAnalyzeRealtimeProsody(): boolean {
    return !!this.humeApiKey;
  }

  /** Open one server-side EVI sidecar for an explicitly opted-in turn. */
  createRealtimeProsodySession(): RealtimeProsodySession | null {
    if (!this.humeApiKey) return null;
    return this.realtimeProsodyFactory(this.humeApiKey);
  }

  /**
   * Keep every TTS caller under the lowest ElevenLabs account concurrency
   * ceiling, not just one multi-voice render. An interrupted phone request
   * can keep rendering server-side while the next turn starts, and without a
   * shared gate those overlapping jobs can turn a speedup into provider 429s.
   */
  private acquireTtsSlot(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        // Reserve the slot before waking a queued caller so a new request
        // cannot slip into the gap between resolve() and its next microtask.
        this.activeTtsRequests += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.activeTtsRequests = Math.max(0, this.activeTtsRequests - 1);
          this.ttsSlotWaiters.shift()?.();
        });
      };

      if (this.activeTtsRequests < ttsConcurrency()) grant();
      else this.ttsSlotWaiters.push(grant);
    });
  }

  /** Transcribe through the preferred configured provider with fallback. */
  async transcribe(audioBuffer: Buffer, mimeType: string, signal?: AbortSignal): Promise<string> {
    // A server on this machine goes first when one is configured, read per
    // request so switching it on or off needs no restart. Anything short of
    // real words, an empty transcript included, hands the turn on to the
    // hosted providers below (see transcribeLocally); only the caller's own
    // abort stops the chain.
    const localUrl = localSttUrl();
    if (localUrl) {
      const startedAt = Date.now();
      const local = await transcribeLocally(localUrl, audioBuffer, mimeType, { signal });
      if (local.ok) {
        console.log(`[Voice] Transcribed locally in ${Date.now() - startedAt}ms (${audioBuffer.length} bytes, ${local.text.length} chars)`);
        return local.text;
      }
      console.warn(`[Voice] Local transcription gave nothing usable after ${Date.now() - startedAt}ms (${local.reason}), trying the hosted providers`);
    }

    let groqError: unknown = null;

    for (const credential of this.groqCredentials) {
      if (this.rejectedGroqKeys.has(credential.key)) continue;
      try {
        return await this.transcribeWithGroq(audioBuffer, mimeType, credential.key, signal);
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') throw error;
        groqError = error;
        if (error instanceof GroqWhisperError && error.isAuthenticationFailure) {
          this.rejectedGroqKeys.add(credential.key);
          const hasAnotherGroqCredential = this.groqCredentials.some(
            ({ key }) => !this.rejectedGroqKeys.has(key),
          );
          console.warn(
            `[Voice] Groq ${credential.source} credential rejected (${error.status})`
            + (hasAnotherGroqCredential ? '; trying another configured Groq credential' : ''),
          );
          continue;
        }
        // Non-authentication failures (bad media, quota, outage, etc.) are
        // credential-independent enough that retrying the same request with a
        // second key is unlikely to help. Preserve the existing provider
        // fallback behavior instead.
        console.warn('[Voice] Groq transcription failed:', error instanceof Error ? error.message : error);
        break;
      }
    }

    if (this.elevenLabsKey) {
      if (groqError) console.warn('[Voice] Trying ElevenLabs Scribe after Groq transcription failure');
      return this.transcribeWithElevenLabs(audioBuffer, mimeType, signal);
    }

    if (groqError) throw groqError;
    throw new Error('No transcription provider configured — add a Groq or ElevenLabs API key');
  }

  private async transcribeWithGroq(
    audioBuffer: Buffer,
    mimeType: string,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const extMap: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/webm;codecs=opus': 'webm',
      'audio/mp4': 'm4a',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
    };
    const baseMime = mimeType.split(';')[0].trim();
    const ext = extMap[baseMime] || 'webm';

    const boundary = `----FormBoundary${crypto.randomUUID().replace(/-/g, '')}`;
    const filename = `recording.${ext}`;

    const preamble = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      `Content-Type: ${baseMime}`,
      '',
      '',
    ].join('\r\n');

    const transcriptionFields = [
      '',
      `--${boundary}`,
      'Content-Disposition: form-data; name="model"',
      '',
      'whisper-large-v3',
      `--${boundary}`,
      'Content-Disposition: form-data; name="language"',
      '',
      'en',
      `--${boundary}`,
      'Content-Disposition: form-data; name="prompt"',
      '',
      buildTranscriptionHint(),
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const body = Buffer.concat([
      Buffer.from(preamble),
      audioBuffer,
      Buffer.from(transcriptionFields),
    ]);

    const response = await fetch(GROQ_WHISPER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new GroqWhisperError(response.status, errText);
    }

    const result = await response.json() as { text: string };
    return result.text || '';
  }

  /**
   * Batch transcription fallback through ElevenLabs Scribe v2. The house
   * already has an ElevenLabs key for companion voices, so a stale Groq key
   * should not make the microphone unusable. Groq remains first when valid;
   * an authentication rejection disables it in-memory until VoiceService is
   * refreshed, avoiding a failed round trip on every conversational turn.
   */
  private async transcribeWithElevenLabs(
    audioBuffer: Buffer,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!this.elevenLabsKey) throw new Error('ElevenLabs API key not configured');

    const baseMime = mimeType.split(';')[0].trim() || 'audio/webm';
    const extMap: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/mp4': 'm4a',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
    };
    const ext = extMap[baseMime] || 'webm';
    const boundary = `----ScribeBoundary${crypto.randomUUID().replace(/-/g, '')}`;
    const filePart = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="recording.${ext}"`,
      `Content-Type: ${baseMime}`,
      '',
      '',
    ].join('\r\n');
    const modelPart = [
      '',
      `--${boundary}`,
      'Content-Disposition: form-data; name="model_id"',
      '',
      'scribe_v2',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await fetch(ELEVENLABS_STT_URL, {
      method: 'POST',
      headers: {
        'xi-api-key': this.elevenLabsKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: Buffer.concat([Buffer.from(filePart), audioBuffer, Buffer.from(modelPart)]),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs Scribe API error ${response.status}: ${errText}`);
    }

    const result = await response.json() as { text?: string };
    return result.text || '';
  }

  /**
   * Analyze prosody (emotional tone) from audio using Hume AI batch API.
   */
  async analyzeProsody(audioBuffer: Buffer, mimeType: string, signal?: AbortSignal): Promise<Record<string, number> | null> {
    if (!this.humeApiKey) return null;

    const baseMime = mimeType.split(';')[0].trim();
    const extMap: Record<string, string> = {
      'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg', 'audio/wav': 'wav',
    };
    const ext = extMap[baseMime] || 'webm';
    const boundary = `----HumeBoundary${crypto.randomUUID().replace(/-/g, '')}`;

    const filePart = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="recording.${ext}"`,
      `Content-Type: ${baseMime}`,
      '', '',
    ].join('\r\n');

    const jsonConfig = JSON.stringify({ models: { prosody: {} } });
    const jsonPart = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="json"',
      'Content-Type: application/json',
      '', jsonConfig,
      `--${boundary}--`, '',
    ].join('\r\n');

    const body = Buffer.concat([
      Buffer.from(filePart), audioBuffer, Buffer.from('\r\n' + jsonPart),
    ]);

    if (signal?.aborted) return null;
    const submitRes = await fetch(HUME_BATCH_URL, {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': this.humeApiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      signal,
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      console.error(`[Hume] Job submit failed ${submitRes.status}: ${errText}`);
      return null;
    }

    const { job_id } = await submitRes.json() as { job_id: string };
    console.log(`[Hume] Job submitted: ${job_id}`);

    const maxPolls = 30;
    for (let i = 0; i < maxPolls; i++) {
      if (signal?.aborted) return null;
      await new Promise(r => setTimeout(r, 1000));
      if (signal?.aborted) return null;

      const statusRes = await fetch(`${HUME_BATCH_URL}/${job_id}`, {
        headers: { 'X-Hume-Api-Key': this.humeApiKey },
        signal,
      });

      if (!statusRes.ok) continue;

      const statusBody = await statusRes.json() as any;
      const jobStatus = statusBody.state?.status;
      console.log(`[Hume] Poll ${i + 1}/${maxPolls}: status=${jobStatus}`);

      if (jobStatus === 'COMPLETED') {
        const predRes = await fetch(`${HUME_BATCH_URL}/${job_id}/predictions`, {
          headers: { 'X-Hume-Api-Key': this.humeApiKey },
          signal,
        });

        if (!predRes.ok) {
          const errBody = await predRes.text();
          console.error(`[Hume] Predictions fetch failed: ${predRes.status} — ${errBody}`);
          return null;
        }

        const predictions = await predRes.json() as any[];
        return this.extractProsodyScores(predictions);
      }

      if (jobStatus === 'FAILED') {
        console.error(`[Hume] Job failed. Full status: ${JSON.stringify(statusBody)}`);
        return null;
      }
    }

    console.warn('[Hume] Job timed out after 30s polling');
    return null;
  }

  private extractProsodyScores(predictions: any[]): Record<string, number> | null {
    try {
      const file = predictions?.[0];
      const results = file?.results?.predictions;
      if (!results?.length) return null;

      const prosody = results[0]?.models?.prosody;
      const grouped = prosody?.grouped_predictions;
      if (!grouped?.length) return null;

      const emotionTotals: Record<string, number[]> = {};
      for (const group of grouped) {
        for (const pred of group.predictions || []) {
          for (const emotion of pred.emotions || []) {
            const name = emotion.name as string;
            const score = emotion.score as number;
            if (!emotionTotals[name]) emotionTotals[name] = [];
            emotionTotals[name].push(score);
          }
        }
      }

      const averaged: [string, number][] = [];
      for (const [name, scores] of Object.entries(emotionTotals)) {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        averaged.push([name, Math.round(avg * 100) / 100]);
      }

      const sorted = averaged.sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (sorted.length === 0) return null;
      return Object.fromEntries(sorted);
    } catch (error) {
      console.error('[Hume] Failed to extract prosody scores:', error);
      return null;
    }
  }

  /**
   * Generate TTS audio from text using ElevenLabs.
   */
  async generateTTS(
    text: string,
    voice?: string,
    voiceIdOverride?: string,
    outputFormat: 'mp3_44100_128' | 'pcm_44100' = 'mp3_44100_128',
  ): Promise<Buffer> {
    const voiceId = this.resolveVoiceId(voice, voiceIdOverride);
    if (!this.elevenLabsKey || !voiceId) {
      throw new Error('ElevenLabs not configured — set ELEVENLABS_API_KEY and voice IDs');
    }

    const voiceKey = voice?.toLowerCase();
    const voice_settings = (voiceKey && this.voiceSettings[voiceKey])
      || { stability: 0.5, similarity_boost: 0.75 };

    const releaseTtsSlot = await this.acquireTtsSlot();
    try {
      // The id and the format land in ElevenLabs' path and query, so neither
      // may carry a slash, a second parameter or anything else of its own.
      const url = `${ELEVENLABS_BASE}/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': this.elevenLabsKey,
          'Content-Type': 'application/json',
          'Accept': outputFormat.startsWith('pcm') ? 'audio/pcm' : 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: resolveTtsModel(getConfig(TTS_MODEL_CONFIG_KEY) as string | undefined),
          voice_settings,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`ElevenLabs error ${response.status}: ${errText}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } finally {
      releaseTtsSlot();
    }
  }

  /**
   * Open an ElevenLabs HTTP TTS stream without first buffering the complete
   * MP3. The provider connection still uses the house-wide two-request gate;
   * the slot is held until the caller consumes or cancels the response body,
   * rather than merely until ElevenLabs sends its response headers.
   *
   * The returned Web stream is deliberately provider-agnostic at its public
   * boundary. Routes can relay chunks to a live listener while retaining the
   * same bytes for late subscribers and the durable read-aloud cache.
   */
  async streamTTS(
    text: string,
    voice?: string,
    voiceIdOverride?: string,
    outputFormat: 'mp3_44100_128' | 'pcm_44100' = 'mp3_44100_128',
  ): Promise<ReadableStream<Uint8Array>> {
    const voiceId = this.resolveVoiceId(voice, voiceIdOverride);
    if (!this.elevenLabsKey || !voiceId) {
      throw new Error('ElevenLabs not configured — set ELEVENLABS_API_KEY and voice IDs');
    }

    const voiceKey = voice?.toLowerCase();
    const voice_settings = (voiceKey && this.voiceSettings[voiceKey])
      || { stability: 0.5, similarity_boost: 0.75 };

    const releaseTtsSlot = await this.acquireTtsSlot();
    try {
      const url = `${ELEVENLABS_BASE}/${encodeURIComponent(voiceId)}/stream?output_format=${encodeURIComponent(outputFormat)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': this.elevenLabsKey,
          'Content-Type': 'application/json',
          'Accept': outputFormat.startsWith('pcm') ? 'audio/pcm' : 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: resolveTtsModel(getConfig(TTS_MODEL_CONFIG_KEY) as string | undefined),
          voice_settings,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`ElevenLabs stream error ${response.status}: ${errText}`);
      }
      if (!response.body) throw new Error('ElevenLabs stream returned no response body');

      const reader = response.body.getReader();
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        releaseTtsSlot();
      };

      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              release();
              controller.close();
              return;
            }
            controller.enqueue(value);
          } catch (error) {
            release();
            controller.error(error);
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } finally {
            release();
          }
        },
      });
    } catch (error) {
      releaseTtsSlot();
      throw error;
    }
  }

  /** Wrap raw PCM in a WAV container. */
  private static wrapPcmAsWav(pcm: Buffer, sampleRate = 44100): Buffer {
    const channels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * channels * bitsPerSample / 8;
    const blockAlign = channels * bitsPerSample / 8;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
  }

  /**
   * Split a reply into per-companion voice segments.
   * Detects speaker markers like **🔥 Name** / **🌫️ Name** and variations.
   * Companion names/emojis are resolved dynamically from the provided list.
   * Text before the first marker defaults to the first companion's voice.
   *
   * @param companions - Array of { slug, display_name, emoji? } to detect.
   *   If omitted, falls back to config default_companion with no splitting.
   */
  static splitByCompanion(
    text: string,
    companions?: Array<{ slug: string; display_name: string; emoji?: string }>,
  ): Array<{ voice: string; text: string }> {
    const defaultVoice = companions?.[0]?.slug
      || getAerieConfig().aerie?.default_companion
      || 'companion';

    return splitCompanionVoiceSegments(text, companions || [], defaultVoice);
  }

  /**
   * Stitch MP3 segments using ffmpeg for proper header handling.
   */
  private static async stitchMp3s(buffers: Buffer[]): Promise<Buffer> {
    if (buffers.length === 0) throw new Error('No segments to stitch');
    if (buffers.length === 1) return buffers[0];

    const dir = await mkdtemp(join(tmpdir(), 'tts-stitch-'));
    try {
      const segPaths: string[] = [];
      for (let i = 0; i < buffers.length; i++) {
        const p = join(dir, `seg${i}.mp3`);
        await writeFile(p, buffers[i]);
        segPaths.push(p);
      }
      const listPath = join(dir, 'list.txt');
      await writeFile(
        listPath,
        segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
      );

      return await new Promise<Buffer>((resolve, reject) => {
        const proc = spawn('ffmpeg', [
          '-hide_banner', '-loglevel', 'error',
          '-f', 'concat', '-safe', '0',
          '-i', listPath,
          '-c:a', 'libmp3lame', '-b:a', '128k',
          '-f', 'mp3', 'pipe:1',
        ]);
        const chunks: Buffer[] = [];
        let stderr = '';
        proc.stdout.on('data', (c) => chunks.push(c));
        proc.stderr.on('data', (c) => { stderr += c.toString(); });
        proc.on('error', (err) => {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new Error('ffmpeg not found on PATH — install it (apt install ffmpeg); multi-voice stitching requires it'));
          } else {
            reject(err);
          }
        });
        proc.on('close', (code) => {
          if (code !== 0) reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`));
          else resolve(Buffer.concat(chunks));
        });
      });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Properly join already-rendered MP3 streams for the durable TTS cache. */
  async stitchTTSBuffers(buffers: Buffer[]): Promise<Buffer> {
    return await VoiceService.stitchMp3s(buffers);
  }

  /**
   * Render multiple voiced segments and stitch into one MP3.
   */
  async generateMultiVoiceMp3(
    segments: Array<{ voice?: string; voiceId?: string; text: string }>,
    opts: { tagsFor?: (voice: string | undefined) => string[] } = {},
  ): Promise<Buffer> {
    // A reply used to go out as one request per speaker, so a companion with a
    // long turn paid one long generation nobody could start listening to until
    // it was finished. Cut each voice into render-sized pieces first: more,
    // shorter requests finish sooner and overlap, and the indexed result array
    // puts them back in speaking order.
    //
    // Tags go on AFTER the cut, so every piece carries them — each piece is its
    // own request and cannot inherit direction from the one before it.
    const pieces = splitSegmentsForRender(segments).filter((seg) => seg.text);
    const renderable = opts.tagsFor ? tagRenderPieces(pieces, opts.tagsFor) : pieces;
    const mp3Buffers = new Array<Buffer>(renderable.length);

    // Match the house-wide gate rather than guessing under it. Every request
    // still queues on acquireTtsSlot, so this pool cannot exceed the provider
    // ceiling — it just stops us leaving a paid-for slot idle.
    let nextIndex = 0;
    const workerCount = Math.min(ttsConcurrency(), renderable.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= renderable.length) return;
        const seg = renderable[index];
        mp3Buffers[index] = await this.generateTTS(seg.text, seg.voice, seg.voiceId);
      }
    }));

    if (!mp3Buffers.length) throw new Error('No segments produced audio');
    return await VoiceService.stitchMp3s(mp3Buffers);
  }

  /**
   * Generate TTS and save it in the thread as a voice note — one audio message
   * per speaker turn, each recorded with the companion whose voice it is.
   *
   * These notes used to arrive as a single audio message with no name on it,
   * and the phone draws a companion's name and avatar from a header in the
   * text, which an audio message does not have. Every note ever sent this way
   * showed up as a bare bubble, with no name and no avatar (noticed Sep 29 2026).
   * The phone already gives a message recorded with metadata.companionSlug that
   * companion's name without a header, so each note now says whose it is — and
   * a note with several companions in it arrives as one bubble per speaker, the way
   * a written reply splits on its headers, rather than every voice stitched
   * into one file that can only carry one name.
   *
   * Each speaker's own voice.note_tags.<slug> go on every piece of their turn.
   */
  async generateTTSForMessage(
    text: string,
    threadId: string,
    opts: { voice?: string; voiceId?: string } = {},
  ): Promise<{ messageId: string; fileId: string; messageIds: string[]; fileIds: string[] }> {
    const filename = 'voice-note.mp3';
    const mime = 'audio/mpeg';
    const companions = VoiceService.getVoiceCompanions();
    const explicit = !!(opts.voice || opts.voiceId);

    // Everything goes through the chunked renderer now, including a reply in a
    // single voice — a lone companion talking at length was the slowest case of
    // all and the one nothing used to split. A reply short enough to render in
    // one piece still costs exactly one request and skips the stitch entirely.
    const segments: Array<{ voice?: string; voiceId?: string; text: string }> = explicit
      ? [{ voice: opts.voice, voiceId: opts.voiceId, text }]
      : VoiceService.splitByCompanion(text, companions);

    const runs = speakerRuns(segments);
    if (runs.length === 0) throw new Error('Nothing to speak in that voice note');

    // Rendered together so a second speaker is not left waiting behind the
    // first; every request still queues on the house-wide TTS gate.
    const buffers = await Promise.all(runs.map(async (run) => {
      try {
        return await this.generateMultiVoiceMp3(run.segments, { tagsFor: (voice) => voiceNoteTagsFor(voice) });
      } catch (err) {
        // Falling back to one whole-turn request keeps a voice note arriving even
        // if ffmpeg is missing or a piece fails; slower beats silent.
        console.warn('[Voice] Chunked render failed, falling back to one request:', (err as Error).message);
        const whole = run.segments.map((segment) => segment.text).join('\n\n');
        return await this.generateTTS(withLeadingTags(whole, voiceNoteTagsFor(run.voice)), run.voice, run.voiceId);
      }
    }));

    const created: Array<{ messageId: string; fileId: string }> = [];
    runs.forEach((run, index) => {
      const fileMeta = saveFile(buffers[index], filename, mime);
      const companionSlug = noteCompanionSlug(run.voice, companions);
      const transcript = explicit ? text : run.segments.map((segment) => segment.text).join('\n\n');
      const now = new Date().toISOString();
      const audioMessage = createMessage({
        id: crypto.randomUUID(),
        threadId,
        role: 'companion',
        content: fileMeta.url,
        contentType: 'audio',
        metadata: {
          transcript,
          fileId: fileMeta.fileId,
          filename: fileMeta.filename,
          size: fileMeta.size,
          ...(companionSlug ? { companionSlug } : {}),
        },
        createdAt: now,
      });

      updateThreadActivity(threadId, now, true);
      registry.broadcast({ type: 'message', message: audioMessage });
      created.push({ messageId: audioMessage.id, fileId: fileMeta.fileId });
    });

    return {
      messageId: created[0].messageId,
      fileId: created[0].fileId,
      messageIds: created.map((c) => c.messageId),
      fileIds: created.map((c) => c.fileId),
    };
  }
}
