// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// On the laptop a game's table talk lives in the conversation's column, not
// under the table. The room's TableTalk hands its box to the column
// through a portal; App reads this to swap the column between the talk and
// the conversation, with a button each way. On the phone none of it runs:
// `desk` stays false and TableTalk draws its box under the table as before.
import { useSyncExternalStore } from 'react';

interface SideTableState {
  /** The laptop layout is on, so a table's talk goes to the column. */
  desk: boolean;
  /** The column's slot for the talk, set by App while the laptop layout is on. */
  slot: HTMLElement | null;
  /** How many table talks are mounted (one room at a time, but counted, not assumed). */
  tables: number;
  /** The column shows the conversation instead of the talk, by the button. */
  showChat: boolean;
}

let state: SideTableState = { desk: false, slot: null, tables: 0, showChat: false };
const listeners = new Set<() => void>();

function set(next: Partial<SideTableState>): void {
  const merged = { ...state, ...next };
  if (merged.desk === state.desk && merged.slot === state.slot && merged.tables === state.tables && merged.showChat === state.showChat) return;
  state = merged;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const read = () => state;

export function useSideTable(): SideTableState {
  return useSyncExternalStore(subscribe, read, read);
}

export const sideTable = {
  setDesk(desk: boolean): void { set(desk ? { desk } : { desk, showChat: false }); },
  setSlot(slot: HTMLElement | null): void { set({ slot }); },
  /** A table talk arrived: the column turns to it. Returns the leave. */
  enter(): () => void {
    set({ tables: state.tables + 1, showChat: false });
    let left = false;
    return () => {
      if (left) return;
      left = true;
      const tables = Math.max(0, state.tables - 1);
      set(tables === 0 ? { tables, showChat: false } : { tables });
    };
  },
  showChat(on: boolean): void { set({ showChat: on }); },
};

/** The talk is in the column right now (the laptop, a table open, the talk chosen). */
export function talkInColumn(s: SideTableState): boolean {
  return s.desk && s.tables > 0 && !s.showChat;
}
