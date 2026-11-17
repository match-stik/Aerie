// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// When a prompt is carried over and one person's reference is swapped for
// another's, the words still name the first person, and the painter is told
// to match every named person to their own reference: the old name has none,
// so it draws the old person from the words. Studio swaps the name in the words along with the chip.

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameRegex(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'gu');
}

/** Whether the words name this person as a whole word (Ash, Ash's; not Ashley). */
export function promptNames(prompt: string, name: string): boolean {
  if (!name.trim()) return false;
  return nameRegex(name.trim()).test(prompt);
}

/** Every whole-word use of one name replaced by another; possessives follow. */
export function swapPromptName(prompt: string, from: string, to: string): string {
  if (!from.trim() || !to.trim() || from === to) return prompt;
  return prompt.replace(nameRegex(from.trim()), to.trim());
}

export interface PendingSwap {
  /** A person just unpicked whose name the words still use. */
  out?: string;
  /** A person just picked whom the words do not name yet. */
  in?: string;
}

/**
 * One chip toggled. Returns the new prompt (unchanged unless this toggle
 * completes a swap) and what is still waiting for its other half. A swap is
 * one person off and one person on, in either order; anything else just
 * clears the waiting half so an unrelated later pick never renames anyone.
 */
export function swapOnToggle(prompt: string, pending: PendingSwap, label: string, picked: boolean): { prompt: string; pending: PendingSwap } {
  if (!picked) {
    if (!promptNames(prompt, label)) return { prompt, pending: {} };
    if (pending.in && !promptNames(prompt, pending.in)) return { prompt: swapPromptName(prompt, label, pending.in), pending: {} };
    return { prompt, pending: { out: label } };
  }
  if (promptNames(prompt, label)) return { prompt, pending: {} };
  if (pending.out && promptNames(prompt, pending.out)) return { prompt: swapPromptName(prompt, pending.out, label), pending: {} };
  return { prompt, pending: { in: label } };
}
