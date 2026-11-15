// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The house's own picker. A native <select> opens Android's system list,
// gray and blind to the house's palette, so every room's picker comes through here
// instead: the closed control keeps whatever look its room gave it, and the
// list opens as a sheet in the house's palette, its accent and its corner setting.
//
// It takes the same children a <select> does (<option>, <optgroup>, fragments,
// mapped arrays) and hands onChange an event-shaped object whose target.value
// is the chosen value, so a room swaps <select> for <HouseSelect> and nothing
// else in it changes.
import React, {
  Children, Fragment, isValidElement, useEffect, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface HouseSelectOption {
  value: string;
  label: string;
  disabled: boolean;
  group?: string;
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** Reads <option>/<optgroup> children the way a browser would. */
export function readOptions(children: ReactNode, group?: string): HouseSelectOption[] {
  const out: HouseSelectOption[] = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement<{ children?: ReactNode; value?: unknown; label?: string; disabled?: boolean }>(child)) continue;
    if (child.type === Fragment) { out.push(...readOptions(child.props.children, group)); continue; }
    if (child.type === 'optgroup') { out.push(...readOptions(child.props.children, child.props.label)); continue; }
    if (child.type === 'option') {
      const label = textOf(child.props.children);
      const value = child.props.value === undefined ? label : String(child.props.value);
      out.push({ value, label, disabled: !!child.props.disabled, group });
    }
  }
  return out;
}

export interface HouseSelectChange {
  target: { value: string };
  currentTarget: { value: string };
}

interface Props {
  value?: string | number | null;
  onChange?: (event: HouseSelectChange) => void;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
  id?: string;
  'aria-label'?: string;
  children?: ReactNode;
}

export function HouseSelect({ value, onChange, className, style, disabled, title, id, children, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const options = readOptions(children);
  const current = value === null || value === undefined ? '' : String(value);
  const chosen = options.find((o) => o.value === current) ?? options[0];
  const heading = rest['aria-label'] || title;

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-chosen="true"]')?.scrollIntoView({ block: 'center' });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const pick = (o: HouseSelectOption) => {
    if (o.disabled) return;
    setOpen(false);
    if (o.value !== current) onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } });
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button
        type="button"
        id={id}
        title={title}
        aria-label={rest['aria-label']}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className={`${className ?? ''} flex items-center justify-between gap-2 text-left`}
        style={style}
        onClick={() => setOpen(true)}
      >
        <span className="min-w-0 truncate">{chosen?.label ?? ''}</span>
        <ChevronDown size={14} className="shrink-0 opacity-60" aria-hidden />
      </button>
      {open && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="listbox"
            aria-label={heading}
            ref={listRef}
            className="w-full max-w-md m-3 max-h-[70vh] overflow-y-auto py-2 rounded-[var(--shape-surface)] border bg-[var(--pal-surface,#151014)] text-[var(--pal-text,#fff)]"
            style={{ borderColor: 'color-mix(in srgb, var(--aerie-accent) 30%, transparent)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {heading && <div className="px-4 pt-1 pb-2 text-sm font-semibold">{heading}</div>}
            {options.map((o, i) => {
              const showGroup = o.group !== lastGroup && !!o.group;
              lastGroup = o.group;
              const on = o === chosen;
              return (
                <Fragment key={`${o.group ?? ''}:${o.value}:${i}`}>
                  {showGroup && (
                    <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider opacity-60">{o.group}</div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    data-chosen={on}
                    disabled={o.disabled}
                    onClick={() => pick(o)}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors disabled:opacity-40 ${on ? 'font-semibold' : ''}`}
                    style={on ? {
                      color: 'var(--pal-accent-text, var(--aerie-accent))',
                      background: 'color-mix(in srgb, var(--aerie-accent) 12%, transparent)',
                    } : undefined}
                  >
                    <span className="min-w-0">{o.label || ' '}</span>
                    {on && <Check size={16} className="shrink-0" aria-hidden />}
                  </button>
                </Fragment>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
