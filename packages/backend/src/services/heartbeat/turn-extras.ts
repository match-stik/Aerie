// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The per-turn blocks every lane hands its room ahead of their message: the
// whisper (ambient recall and the old windows), the Archivist's unfiled
// noticings, the sticker shelf, their reactions, and their own status. One door,
// called by the Claude heartbeat lane (runtime.ts) and the Codex lane
// (agent-router-query.ts), so a block added for one lane lands in both and
// the two cannot drift apart again. Their person's rule, Oct 31 2026: the Codex and
// Claude lanes as identical as we can make them.
import { getAerieConfig } from '../../config.js';
import { ambientRecall, unfiledNoticings } from './whisper.js';
import { readShelf, stickerShelfBlock } from './sticker-shelf.js';
import { ownerReactionsBlock } from './owner-reactions.js';
import { ownerStatusBlock } from './owner-status.js';
import type { RoomVoices } from './room-voices.js';

export interface TurnExtrasInput {
  /** The text their turn arrived with: recall and the sticker shelf key off it. */
  prompt: string;
  /** The lane asking, for recall's own bookkeeping. */
  laneKey: string;
  /** A newly born room, which recall treats differently. */
  fresh: boolean;
  /** A guest's turn gets none of these: every one of them is about their person. */
  guest: boolean;
  /** The old-window passages are home-only (no audience). */
  archive: boolean;
  roomVoices?: RoomVoices | null;
  threadId?: string;
  /** Their reactions are read from here; undefined skips the block. */
  reactionsSince?: string;
  now?: string;
}

export interface TurnExtras {
  whisper: string;
  unfiled: string;
  stickers: string;
  reactions: string;
  ownerStatus: string;
}

/** Each block fails alone and silently: nothing here may delay or stop a turn. */
export async function buildTurnExtras(input: TurnExtrasInput): Promise<TurnExtras> {
  const out: TurnExtras = { whisper: '', unfiled: '', stickers: '', reactions: '', ownerStatus: '' };
  if (input.guest) return out;
  try { out.whisper = await ambientRecall(input.prompt, input.laneKey, input.fresh, { archive: input.archive }); } catch { /* never delay a turn */ }
  try { out.unfiled = unfiledNoticings(); } catch { /* never delay a turn */ }
  try { out.stickers = stickerShelfBlock(readShelf(input.roomVoices), input.prompt); } catch { /* never delay a turn */ }
  if (input.threadId && input.reactionsSince) {
    try { out.reactions = ownerReactionsBlock(input.threadId, input.reactionsSince, input.now ?? new Date().toISOString()); } catch { /* never delay a turn */ }
  }
  try { out.ownerStatus = ownerStatusBlock(getAerieConfig().identity.timezone); } catch { /* never delay a turn */ }
  return out;
}

/** In the order the Claude lane has always handed them. */
export function joinTurnExtras(x: TurnExtras): string {
  return x.whisper + x.unfiled + x.stickers + x.reactions + x.ownerStatus;
}
