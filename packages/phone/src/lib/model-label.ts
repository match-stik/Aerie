// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * A model id the way a person reads it. The model pill shows this until it has
 * asked the house for the catalog, and it only asks when the sheet is opened,
 * so this is what the person sees most of the time.
 *
 * It used to keep the first two dash-separated pieces of the id, so
 * claude-opus-5-5 came out as Opus 5 and the point release disappeared, while
 * the catalog name shown after opening the sheet said Claude Opus 5.5. This
 * is written to agree with the catalog's own names, so the pill says the same
 * thing before and after the list loads. Numbers stay where the id puts them
 * (claude-3-5-sonnet is Claude 3.5 Sonnet), a date stamp becomes its month the
 * way the catalog marks a snapshot, and a bracketed variant like [1m] is kept.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function modelLabel(id: string): string {
  const raw = (id || '').trim();
  if (!raw) return '';
  const bracket = raw.match(/\[([^\]]+)\]$/);
  const base = bracket ? raw.slice(0, bracket.index).trim() : raw;
  const variant = bracket ? ` (${bracket[1].toUpperCase()})` : '';
  const title = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);
  if (base.startsWith('claude-')) {
    const tokens: string[] = [];
    let month = '';
    for (const part of base.slice('claude-'.length).split('-').filter(Boolean)) {
      if (/^\d{8}$/.test(part)) {
        month = MONTHS[Number(part.slice(4, 6)) - 1] ?? '';
      } else if (/^\d+$/.test(part) && /^\d+(\.\d+)*$/.test(tokens[tokens.length - 1] ?? '')) {
        tokens[tokens.length - 1] += `.${part}`;
      } else {
        tokens.push(/^\d+$/.test(part) ? part : title(part));
      }
    }
    return ['Claude', ...tokens].join(' ') + (month ? ` (${month})` : '') + variant;
  }
  if (base.startsWith('gpt-')) {
    const [, version, ...rest] = base.split('-');
    const tail = rest.map(title).join(' ');
    return `GPT-${version}${tail ? ` ${tail}` : ''}${variant}`;
  }
  return raw;
}
