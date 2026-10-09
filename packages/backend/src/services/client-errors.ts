// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// What the phone says when a screen falls over.
//
// The phone had no error boundary and reported nothing, so a render error
// blacked out the whole app with no trace anywhere, and the cause had to be
// found by reading code. Now the boundary catches the fall and posts what
// broke here. One bounded line per
// report, so a crash loop cannot fill the log with megabytes of stack.

const LIMITS = { message: 500, stack: 2000, componentStack: 2000, where: 200 } as const;

function bounded(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** The log line for one report, or null when the body carries nothing to say. */
export function clientErrorLine(body: unknown, now = new Date()): string | null {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const message = bounded(b.message, LIMITS.message).trim();
  if (!message) return null;
  return JSON.stringify({
    at: now.toISOString(),
    where: bounded(b.where, LIMITS.where),
    message,
    stack: bounded(b.stack, LIMITS.stack),
    componentStack: bounded(b.componentStack, LIMITS.componentStack),
  });
}
