// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The metadata at the front of an MP3 piece, measured so it can be left out
// when pieces are sent one after another as a single stream.
//
// A read-aloud reply is rendered as several pieces, one per voice, and the
// whole-reply stream (routes/api.ts, tts/stream/:jobId/all) sends them back to
// back so an Android phone plays one file and keeps playing with the app in
// the background (Oct 22 2026). A piece can open with an ID3 tag and a
// Xing or Info frame that states its own length; in the middle of a stream the
// tag is noise, and a length header on the first piece can make a player think
// the whole reply is only that long. Both are skipped; the audio frames are
// passed through untouched.

const BITRATES_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES = [
  [11025, 12000, 8000], // MPEG 2.5
  [0, 0, 0], // reserved
  [22050, 24000, 16000], // MPEG 2
  [44100, 48000, 32000], // MPEG 1
];

/** Byte length of a Layer III frame whose header starts at `at`, or null if there is no valid header there. */
function frameLength(buf: Buffer, at: number): number | null {
  if (at + 4 > buf.length) return null;
  if (buf[at] !== 0xff || (buf[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (buf[at + 1] >> 3) & 0x03;
  const layer = (buf[at + 1] >> 1) & 0x03;
  if (version === 1 || layer !== 0x01) return null; // reserved version, or not Layer III
  const bitrateIndex = (buf[at + 2] >> 4) & 0x0f;
  const sampleIndex = (buf[at + 2] >> 2) & 0x03;
  const padding = (buf[at + 2] >> 1) & 0x01;
  const kbps = (version === 3 ? BITRATES_MPEG1_L3 : BITRATES_MPEG2_L3)[bitrateIndex];
  const rate = SAMPLE_RATES[version][sampleIndex];
  if (!kbps || !rate) return null;
  const perFrame = version === 3 ? 144 : 72;
  return Math.floor((perFrame * kbps * 1000) / rate) + padding;
}

/**
 * How many leading bytes of this piece are metadata rather than audio: an ID3v2
 * tag, then a Xing, Info or VBRI frame if the first frame is one. Null means
 * the bytes so far are too few to tell; ask again with more.
 */
export function mp3LeadLength(buf: Buffer): number | null {
  let at = 0;
  if (buf.length < 10) return null;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    const footer = (buf[5] & 0x10) ? 10 : 0;
    at = 10 + size + footer;
  }
  if (buf.length < at + 4) return null;
  const length = frameLength(buf, at);
  if (length === null) return at; // not a frame header: leave the rest exactly as it is
  if (buf.length < at + Math.min(length, 64)) return null;
  const head = buf.subarray(at, at + Math.min(length, 64)).toString('latin1');
  if (head.includes('Xing') || head.includes('Info') || head.includes('VBRI')) return at + length;
  return at;
}
