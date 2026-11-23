// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * A thread's own model.
 *
 * A thread with no model of its own rides the house model, which is every
 * thread until somebody picks one. A thread with one uses it for the messages
 * said in it; wakes keep the wake model, because a bell is the house's, not
 * the room's.
 *
 * The catch this is built around: a warm Claude room runs one model at a
 * time, and asking it for another one tears it down and builds it again
 * (supervisor ensure() recycles on a model change). Two threads on two models
 * sharing one room would rebuild it every time they moved between them, and a
 * rebuild mid-reply kills the reply. So a thread on a model other than the
 * room's natural one gets a room of its own beside it, one per model, and
 * threads on the same model share it the way every thread already shares the
 * main room. Codex threads need none of this: a Codex room belongs to its
 * thread already and is handed the model on every turn.
 */
import { readdirSync, existsSync, mkdirSync, copyFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db.js';
import { laneDirName } from '../heartbeat/lane-dir.js';

/** The model stored on a thread, or null when it rides the house's. */
export function readThreadModel(threadId: string): string | null {
  try {
    const row = getDb().prepare('SELECT model FROM threads WHERE id = ?').get(threadId) as { model?: string | null } | undefined;
    const model = row?.model?.trim();
    return model ? model : null;
  } catch {
    // A database without the column yet is a house without the feature.
    return null;
  }
}

/**
 * Whether a thread has a room of its own: a separate session for one
 * thread. A thread with one is answered by its
 * own warm session beside the usual one, which knows the house through the
 * walls, recall and the thread's own recent messages rather than through the
 * main room's evening; it can be started fresh without touching the main room.
 * Bells keep their own rooms either way.
 */
export function readThreadOwnRoom(threadId: string): boolean {
  try {
    const row = getDb().prepare('SELECT own_room FROM threads WHERE id = ?').get(threadId) as { own_room?: number | null } | undefined;
    return Boolean(row?.own_room);
  } catch {
    return false;
  }
}

/**
 * A thread room's own wall dial: for each wall, Always,
 * If there's room or Search only, stored on the thread as {"scope/label":
 * mode}. A wall not in it follows the house's dial. It only means anything
 * for a thread with its own room: a thread sharing the main room shares the
 * main room's walls, because it is the same session reading the same file.
 */
export type ThreadWallMode = 'always' | 'room' | 'search';
export function parseThreadWallLoad(raw: string | null | undefined): Record<string, ThreadWallMode> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, ThreadWallMode> = {};
    for (const [k, v] of Object.entries(obj ?? {})) if (v === 'always' || v === 'room' || v === 'search') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function readThreadWallLoad(threadId: string): Record<string, ThreadWallMode> {
  try {
    const row = getDb().prepare('SELECT wall_load FROM threads WHERE id = ?').get(threadId) as { wall_load?: string | null } | undefined;
    return parseThreadWallLoad(row?.wall_load);
  } catch {
    return {};
  }
}

export function writeThreadWallLoad(threadId: string, scope: string, label: string, mode: ThreadWallMode | null): Record<string, ThreadWallMode> {
  const current = readThreadWallLoad(threadId);
  if (mode) current[`${scope}/${label}`] = mode;
  else delete current[`${scope}/${label}`];
  getDb().prepare('UPDATE threads SET wall_load = ? WHERE id = ?').run(Object.keys(current).length ? JSON.stringify(current) : null, threadId);
  return current;
}

/** The dial a turn in this thread loads its walls by, or undefined for the house's. */
export function threadWallOverride(threadId: string | null | undefined): ((scope: string, label: string) => ThreadWallMode | undefined) | undefined {
  if (!threadId || !readThreadOwnRoom(threadId)) return undefined;
  const map = readThreadWallLoad(threadId);
  if (Object.keys(map).length === 0) return undefined;
  return (scope, label) => map[`${scope}/${label}`];
}

/** The marker in a lane key that says the room belongs to one thread. */
export function threadRoomTag(threadId: string): string {
  return `--t-${threadId.replace(/[^a-zA-Z0-9-_]/g, '_')}`;
}

/**
 * The lane a turn in this thread rides, or null for the usual one. A thread
 * with its own room gets base--t-<thread>, and on a model other than the
 * lane's natural one, that room's own model room beside it; a thread with
 * only a model of its own shares that model's room with every other thread on
 * the model (modelLaneKey), as before.
 */
export function threadLaneKey(baseKey: string, threadId: string, ownRoom: boolean, model: string, naturalModel: string): string | null {
  if (!ownRoom) return modelLaneKey(baseKey, model, naturalModel);
  const room = `${baseKey}${threadRoomTag(threadId)}`;
  return modelLaneKey(room, model, naturalModel) ?? room;
}

/** The model a turn in this thread asks for before any companion's own. */
export function threadTurnModel(threadModel: string | null, isAutonomous: boolean, houseModel: string): string {
  if (isAutonomous) return houseModel;
  return threadModel || houseModel;
}

/**
 * The lane a turn rides when its model is not the one that lane normally
 * runs. Null means the usual lane. The key names the model so every thread on
 * that model shares one room, and the room it sits beside, so a companion's
 * own head on another model is not the shared room on that model.
 */
export function modelLaneKey(baseKey: string, model: string, naturalModel: string): string | null {
  if (!model || model === naturalModel) return null;
  return `${baseKey}--${model.replace(/[^a-zA-Z0-9-_]/g, '_')}`;
}

/**
 * The model rooms beside every lane in the list, as found on disk. The
 * missed-message net reads each lane's receipt, so a room has to know about
 * the model rooms next to it or it hands back as missed a scene its neighbour
 * already answered (say they set a thread back to the house model).
 */
export function modelLanesBeside(heartbeatDir: string, keys: readonly string[]): string[] {
  let names: string[];
  try { names = readdirSync(heartbeatDir); } catch { return []; }
  const prefixes = keys.map((k) => `${laneDirName(k)}--`);
  return names.filter((n) => prefixes.some((p) => n.startsWith(p)));
}

/**
 * A new model room is handed the MCP servers of the room it sits beside, so
 * a thread on its own model has the same tools the usual room does. The file
 * is placed by hand in the lane folder (it carries keys), so it is copied
 * once, owner-only, and never overwritten.
 */
export function seedModelLaneTools(heartbeatDir: string, laneKey: string, baseKey: string): void {
  const from = join(heartbeatDir, laneDirName(baseKey), '.mcp.json');
  const dir = join(heartbeatDir, laneDirName(laneKey));
  const to = join(dir, '.mcp.json');
  try {
    if (!existsSync(from) || existsSync(to)) return;
    mkdirSync(dir, { recursive: true });
    copyFileSync(from, to);
    chmodSync(to, 0o600);
  } catch (err) {
    console.warn(`[Agent] Could not hand ${laneKey} the usual room's tools:`, err);
  }
}
