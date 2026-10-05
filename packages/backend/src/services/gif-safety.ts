// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * The GIF Lab names its own session folders and frames, but the browser sends
 * those names back, so each one is checked before it becomes part of a path. A
 * plain name (no slash, no backslash, no '..', no NUL) joined onto a folder can
 * only ever land inside that folder.
 */
export function isPlainName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 200
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('..')
    && !value.includes('\0');
}

/**
 * Values that go into an ffmpeg drawtext filter. The text and the font name sit
 * inside quotes and are escaped; a colour or a size sits outside any quotes, so
 * it may only be a colour (a name, #rrggbb or 0xrrggbb, with an optional
 * @alpha) or a number, which keeps a ':' or a quote from starting a filter
 * option of its own (textfile= would read any file the house can).
 */
export function escapeDrawtextValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/:/g, '\\:');
}

export function isDrawtextColor(value: unknown): value is string {
  return typeof value === 'string' && /^(#|0x)?[A-Za-z0-9]{1,32}(@[0-9.]{1,5})?$/.test(value);
}

export function isDrawtextSize(value: unknown): boolean {
  const n = Number(value);
  return typeof value !== 'boolean' && Number.isFinite(n) && n > 0 && n <= 1000;
}
