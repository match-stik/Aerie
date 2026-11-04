// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React, { useState } from 'react';
import { ChevronRight, Loader2, Sparkles, Wrench } from 'lucide-react';
import { cn } from '../lib/utils';
import type { MessageSegment } from '../aerie';

type ToolSegment = MessageSegment & { type: 'tool' };

/**
 * The tools chip, closed by default, that opens into the list of what ran.
 *
 * Theirs, Nov 2 2026: the chip showed only a count. They did not want tool calls
 * filling the room again (they were folded into one chip at their word, Oct 26),
 * but they did want to see what was in it, most of all when a skill loaded. So
 * the chip stays one small line, and a tap opens the list under it.
 */
export function toolLine(seg: ToolSegment): { label: string; detail: string; skill: boolean } {
  let detail = '';
  const raw = seg.input || '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.detail === 'string') detail = parsed.detail;
    else if (parsed && typeof parsed === 'object' && typeof parsed.skill === 'string') detail = parsed.skill;
    else detail = raw;
  } catch {
    detail = raw;
  }
  const name = seg.toolName || 'tool';
  const skill = name === 'Skill';
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  detail = detail.replace(/\s+/g, ' ').trim();
  // A file's own name says enough; the whole path only pushed past the bubble
  // (theirs, Nov 2 2026: 'little messy').
  const fileName = (d: string) => d.split('/').filter(Boolean).pop() || d;
  const words: Record<string, string> = {
    Bash: 'Ran', Read: 'Read', Edit: 'Edited', Write: 'Wrote', Grep: 'Searched', Glob: 'Looked for',
    WebSearch: 'Searched the web', WebFetch: 'Read a page', ToolSearch: 'Found a tool', Compacting: 'Squashing',
  };
  if (['Read', 'Edit', 'Write'].includes(name)) detail = fileName(detail);
  const label = skill ? 'Skill'
    : mcp ? `${mcp[2].replace(/_/g, ' ')} (${mcp[1].replace(/^claude_ai_/, '')})`
    : words[name] || name;
  return { label, detail, skill };
}

interface ToolListProps {
  tools: ToolSegment[];
  borderClass: string;
  /** While a turn is still running: the spinner and the working phrase. */
  phrase?: string;
  /** The finished message's wording, 'N tools used'. */
  finished?: boolean;
  /** Starts open; only the layout check uses it. */
  defaultOpen?: boolean;
}

export function ToolList({ tools, borderClass, phrase, finished, defaultOpen }: ToolListProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  if (tools.length === 0 && phrase === undefined) return null;
  const n = tools.length;
  const count = `${n} tool${n !== 1 ? 's' : ''}${finished ? ' used' : ''}`;
  return (
    <div className={cn('min-w-0 max-w-full self-start', finished ? 'my-0.5' : 'my-1.5', open && 'self-stretch')}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1.5 rounded-[var(--shape-control)] border px-2.5 py-1 text-left text-[11px]',
          finished && 'opacity-60',
          borderClass,
        )}
        style={{ background: 'rgba(127,127,127,0.08)' }}
      >
        {phrase !== undefined
          ? <Loader2 size={11} className="shrink-0 animate-spin opacity-70" />
          : <Wrench size={11} className="shrink-0" />}
        {phrase !== undefined && <span className="font-medium">{phrase}…</span>}
        {n > 0 && <span className={cn(phrase !== undefined && 'opacity-60')}>{phrase !== undefined ? `· ${count}` : count}</span>}
        {n > 0 && <ChevronRight size={11} className={cn('shrink-0 opacity-60 transition-transform', open && 'rotate-90')} />}
      </button>
      {open && n > 0 && (
        <div className="mt-1 max-h-48 min-w-0 overflow-y-auto overflow-x-hidden pl-1 text-[11px] leading-snug">
          {tools.map((seg, i) => {
            const { label, detail, skill } = toolLine(seg);
            return (
              <div key={seg.toolId || i} className={cn('flex min-w-0 items-center gap-1.5 py-0.5', !skill && 'opacity-70')}>
                {skill
                  ? <Sparkles size={11} className="shrink-0" />
                  : <Wrench size={10} className="shrink-0 opacity-70" />}
                <span className="min-w-0 flex-1 truncate">
                  <span className={cn(skill ? 'font-semibold' : 'font-medium')}>{label}</span>
                  {detail && <span>{skill ? ': ' : ' · '}{detail}</span>}
                  {seg.isError && <span className="opacity-80"> (failed)</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
