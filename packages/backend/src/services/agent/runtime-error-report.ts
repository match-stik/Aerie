// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Should a finished turn account for itself in the room?
 *
 * A turn that produced no words but did produce a runtime error becomes a
 * visible ⚠ system line rather than a '[No response]' bubble — refusals,
 * provider outages and timeouts have to be seen where the user is, not buried in
 * the server log.
 *
 * This is a separate decision from HOW the turn ended, which is the whole
 * point of it living here. It used to be tangled up with the finish reason,
 * so a turn the user stopped returned early and the explanation went in the bin —
 * and stopping it is exactly what a person does when a turn has hung, which
 * made the silence self-inflicting: the more obviously broken the turn, the
 * less likely they were to be told why.
 */
export function shouldReportRuntimeError(
  fullResponse: string,
  runtimeError: string | null | undefined,
): boolean {
  return !fullResponse.trim() && !!runtimeError && !!runtimeError.trim();
}
