// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Marks an italic that is a whole line by itself, an action line, so Quieter
// action lines can soften those and leave an italic word inside a sentence
// alone.
// A line is bounded by the start or end of its paragraph or by a line break;
// whitespace between does not count. A rehype plugin with no imports, so it can
// be tested on a hand-built tree.

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const isBlank = (n: HastNode) => n.type === 'text' && !(n.value ?? '').trim();
const isBreak = (n: HastNode) => n.type === 'element' && n.tagName === 'br';

function markIn(parent: HastNode): void {
  const kids = parent.children ?? [];
  kids.forEach((kid, i) => {
    if (kid.type === 'element' && kid.tagName === 'em') {
      let before = i - 1;
      while (before >= 0 && isBlank(kids[before])) before--;
      let after = i + 1;
      while (after < kids.length && isBlank(kids[after])) after++;
      const startsLine = before < 0 || isBreak(kids[before]);
      const endsLine = after >= kids.length || isBreak(kids[after]);
      if (startsLine && endsLine && parent.tagName !== 'em') {
        const props = (kid.properties ??= {});
        const had = Array.isArray(props.className) ? props.className as string[] : [];
        if (!had.includes('aerie-action')) props.className = [...had, 'aerie-action'];
      }
    }
    if (kid.children) markIn(kid);
  });
}

export function rehypeActionLines() {
  return (tree: HastNode) => { markIn(tree); };
}
