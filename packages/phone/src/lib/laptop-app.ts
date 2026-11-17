// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What the Aerie app on their laptop (desktop/preload.cjs) hands the page, read
// safely: in a browser or on the phone there is none and every answer is null.

export interface LaptopApp {
  about(): Promise<{ version: string; startWithWindows: boolean | null }>;
  setStartWithWindows(on: boolean): Promise<boolean | null>;
  checkUpdate(): Promise<{ current: string; latest: string | null; newer: boolean }>;
  installUpdate(): Promise<{ ok: boolean; error?: string }>;
}

export function laptopApp(): LaptopApp | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as { aerieDesktop?: Partial<LaptopApp> }).aerieDesktop;
  return bridge && typeof bridge.about === 'function' && typeof bridge.checkUpdate === 'function' ? bridge as LaptopApp : null;
}

const reported = new Set<string>();

/**
 * One line in the house's error log from inside the laptop app, once per
 * subject per page load, so a thing that will not load there can be read from
 * the house.
 * Says nothing anywhere else.
 */
export function reportFromLaptop(subject: string, message: string): void {
  if (!laptopApp() || reported.has(subject)) return;
  reported.add(subject);
  void import('../aerie/api').then(({ apiFetch }) => apiFetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ where: `laptop-${subject}`, message, stack: '', componentStack: '' }),
  })).catch(() => {});
}
