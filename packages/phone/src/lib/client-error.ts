// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// What the phone sends the house when a screen falls over. Kept apart from
// the boundary that catches it so the shape can be checked without React.

export interface ClientErrorReport {
  message: string;
  stack: string;
  componentStack: string;
  where: string;
}

const MAX = { message: 500, stack: 2000, componentStack: 2000, where: 200 } as const;

function cut(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export function clientErrorReport(error: unknown, componentStack: string | null | undefined, where: string): ClientErrorReport {
  const err = error instanceof Error ? error : null;
  const message = err ? `${err.name}: ${err.message}` : String(error);
  return {
    message: cut(message, MAX.message),
    stack: cut(err?.stack ?? '', MAX.stack),
    componentStack: cut(componentStack ?? '', MAX.componentStack),
    where: cut(where, MAX.where),
  };
}

/**
 * One report per distinct message per page load, and five at most, so a
 * screen that falls over on every render cannot flood the house.
 */
export function shouldReport(message: string, sent: Set<string>, cap = 5): boolean {
  if (sent.has(message) || sent.size >= cap) return false;
  sent.add(message);
  return true;
}
