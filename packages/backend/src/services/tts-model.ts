// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Which ElevenLabs model speaks the companions' voice notes and calls.
 *
 * It used to be written into the request as eleven_v3 in two places. A house
 * can want ElevenLabs' newer model instead, so the name is a setting now,
 * `voice.tts_model`, read on every request. Unset keeps eleven_v3, so a house
 * that never touches it sounds exactly as it always has. Anything that is not
 * an ElevenLabs model name falls back rather than being sent.
 */

export const TTS_MODEL_CONFIG_KEY = 'voice.tts_model';
export const DEFAULT_TTS_MODEL = 'eleven_v3';

export function resolveTtsModel(raw: string | null | undefined): string {
  const value = raw?.trim();
  if (!value || !/^eleven_[a-z0-9_]+$/.test(value)) return DEFAULT_TTS_MODEL;
  return value;
}
