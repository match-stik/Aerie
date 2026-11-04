// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Cancelling a Studio job (theirs, Oct 29 2026: a refused picture sat out the
 * whole fallback wait while every job behind it waited too). A pending job is
 * skipped when its turn comes. A running one frees the queue at once: the
 * child process it runs (Codex or Antigravity) is killed, and the job stops
 * waiting on any backend it was polling. A backend that cannot be killed
 * mid-poll (OpenArt, Mage) may still finish in the background, and that
 * picture is discarded rather than delivered.
 */
export const cancelHooks = new Map<string, Set<() => void>>();
let runningJobId: string | null = null;

/** Kill this child if the running job is cancelled. Returns the unregister. */
export function onRunningJobCancel(kill: () => void): () => void {
  const id = runningJobId;
  if (!id) return () => undefined;
  const set = cancelHooks.get(id) ?? new Set();
  cancelHooks.set(id, set);
  set.add(kill);
  return () => { set.delete(kill); };
}

export function setRunningJob(id: string): void {
  runningJobId = id;
}

export function clearRunningJob(id: string): void {
  if (runningJobId === id) runningJobId = null;
}
