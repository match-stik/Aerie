// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// One reply, read aloud, as one stream.
//
// The read-aloud stream route renders a reply as several pieces at once, one
// per voice, and hands the phone a URL per piece so the first words play
// before the rest are made. On Android the phone plays those pieces one after
// another on a single audio element, and moving from one piece to the next is
// a job the app's own code does. With the app in the background Android stops
// running that code, so a reply went quiet at the next voice (Oct 22 2026).
//
// This sends every piece's bytes in order down one response as they are made,
// so the phone sees one file it can play to the end by itself, and the first
// words still arrive as soon as the first piece starts. Each piece's leading
// metadata (an ID3 tag, a length header) is left out; the audio frames are
// passed through untouched.
import { mp3LeadLength } from './mp3-lead.js';

export interface WholeStreamPiece {
  chunks: Buffer[];
  byteLength: number;
  state: 'pending' | 'streaming' | 'complete' | 'error';
  error?: Error;
  /** Woken whenever a chunk lands or the piece finishes or fails. */
  waiters: Set<() => void>;
}

export interface WholeStreamResponse {
  readonly headersSent: boolean;
  write(chunk: Buffer): boolean;
  end(): void;
  destroy(error?: Error): void;
  once(event: 'close' | 'drain', listener: () => void): unknown;
  off(event: 'close' | 'drain', listener: () => void): unknown;
}

/** Wake everything waiting on this piece. Call after a chunk lands, or the piece completes or fails. */
export function wakeWholeStreamWaiters(piece: WholeStreamPiece): void {
  const waiters = [...piece.waiters];
  piece.waiters.clear();
  for (const wake of waiters) wake();
}

/** The finished pieces as one buffer, each piece's leading metadata left out. */
export function wholeFromFinished(buffers: Buffer[]): Buffer {
  return Buffer.concat(buffers.map((buffer) => buffer.subarray(mp3LeadLength(buffer) ?? 0)));
}

/**
 * Pipe every piece, in order, down one response as its bytes arrive.
 * `writeHeaders` commits the audio response and is called only once the first
 * real audio byte is ready, so a provider failure before then can still answer
 * with `failBeforeAudio` instead of a blank 200.
 */
export async function pipeWholeStream(
  pieces: WholeStreamPiece[],
  res: WholeStreamResponse,
  writeHeaders: () => void,
  failBeforeAudio: (message: string) => void,
): Promise<void> {
  let closed = false;
  const pending = new Set<() => void>();
  const onClose = () => {
    closed = true;
    for (const wake of [...pending]) wake();
  };
  res.once('close', onClose);

  const changed = (piece: WholeStreamPiece) => new Promise<void>((resolve) => {
    const wake = () => {
      pending.delete(wake);
      piece.waiters.delete(wake);
      resolve();
    };
    pending.add(wake);
    piece.waiters.add(wake);
  });

  const drained = () => new Promise<void>((resolve) => {
    const finish = () => {
      res.off('drain', finish);
      pending.delete(finish);
      resolve();
    };
    pending.add(finish);
    res.once('drain', finish);
  });

  try {
    for (const piece of pieces) {
      let chunkIndex = 0;
      let offset = 0;
      let leadMeasured = false;

      for (;;) {
        if (closed) return;
        if (piece.state === 'error') {
          if (!res.headersSent) failBeforeAudio(piece.error?.message || 'TTS stream failed');
          else res.destroy(piece.error);
          return;
        }

        if (!leadMeasured) {
          let lead = mp3LeadLength(Buffer.concat(piece.chunks, piece.byteLength));
          if (lead === null && piece.state === 'complete') lead = 0;
          if (lead !== null) {
            leadMeasured = true;
            let remaining = lead;
            while (chunkIndex < piece.chunks.length && remaining >= piece.chunks[chunkIndex].length) {
              remaining -= piece.chunks[chunkIndex].length;
              chunkIndex++;
            }
            offset = remaining;
          }
        }

        if (leadMeasured) {
          while (!closed && chunkIndex < piece.chunks.length) {
            const chunk = piece.chunks[chunkIndex];
            const bytes = offset ? chunk.subarray(offset) : chunk;
            chunkIndex++;
            offset = 0;
            if (!bytes.length) continue;
            writeHeaders();
            if (!res.write(bytes)) await drained();
          }
          if (piece.state === 'complete' && chunkIndex >= piece.chunks.length) break;
        }

        await changed(piece);
      }
    }
    if (!closed) {
      if (!res.headersSent) {
        failBeforeAudio('TTS stream produced no audio');
        return;
      }
      res.end();
    }
  } finally {
    res.off('close', onClose);
    for (const piece of pieces) {
      for (const wake of pending) piece.waiters.delete(wake);
    }
    pending.clear();
  }
}
