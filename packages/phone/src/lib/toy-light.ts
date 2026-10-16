// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A lane's light ask on their phone: which of the owner's toys it reaches and which
// light command each one gets, worked out from the command names each toy's
// SDK reports, and then sent toy by toy through whatever sender it is handed.
//
// It is handed a sender and nothing else, so it cannot reach what is playing:
// a light never stops or replaces a motor. The installed app already sends
// these as plain commands (LovenseToysPlugin's PLAIN set), and refuses them
// while the owner's stop holds, the same as motion, so no new app build is needed.
//
// Which pair: Lovense's SDK README calls LIGHT_ON and LIGHT_OFF "the light",
// listed for most toys, and ALIGHT_ON and ALIGHT_OFF "the Domi/Domi 2 light",
// listed for the Domi and the Domi 2 beside the other pair. The Toys page
// switches ALIGHT on a toy that lists it, so a toy that lists ALIGHT uses it
// unless the ask names the pair. FLASH is "flash the light 3 times".
// Kept free of the app so it can be checked without a toy in the room.

import type { ToyLightAction, ToyLightAsk, ToyLightPair, ToyLightResult, ToyRemoteAck } from '@aerie/shared';

/** The light commands a toy may list, in the order they are reported. */
export const LIGHT_COMMANDS = ['FLASH', 'LIGHT_ON', 'LIGHT_OFF', 'ALIGHT_ON', 'ALIGHT_OFF'] as const;

export interface LightToy {
  toyId: string;
  name: string;
  commands: readonly string[];
}

export type LightSend = (toyId: string, command: string) => Promise<'ok' | 'held' | 'failed'>;

/** The light commands a toy lists, for the house to show a lane. */
export function lightsFor(toy: { commands: readonly string[] }): string[] {
  return LIGHT_COMMANDS.filter((c) => toy.commands.includes(c));
}

const PAIR_COMMANDS: Record<ToyLightPair, { on: string; off: string }> = {
  light: { on: 'LIGHT_ON', off: 'LIGHT_OFF' },
  alight: { on: 'ALIGHT_ON', off: 'ALIGHT_OFF' },
};

/** The command one toy gets for an action, or why it has none. */
export function lightCommandFor(
  toy: { commands: readonly string[] },
  action: ToyLightAction,
  which?: ToyLightPair,
): { command: string } | { why: string } {
  const has = (c: string) => toy.commands.includes(c);
  if (action === 'flash') return has('FLASH') ? { command: 'FLASH' } : { why: 'it lists no FLASH' };
  if (which) {
    const command = PAIR_COMMANDS[which][action];
    return has(command) ? { command } : { why: `it lists no ${command}` };
  }
  for (const pair of ['alight', 'light'] as const) {
    const command = PAIR_COMMANDS[pair][action];
    if (has(command)) return { command };
  }
  return { why: `it lists no light it can switch ${action}` };
}

const bare = (s: string) => s.trim().toLowerCase().replace(/^lovense\s+/, '');

/** Whether an ask's toy (an id, or a name as GET shows it) is this toy. */
export function isAskedToy(asked: string, toy: { toyId: string; name: string }): boolean {
  if (asked.trim() === toy.toyId) return true;
  return bare(asked) !== '' && bare(asked) === bare(toy.name);
}

export interface LightPlan {
  /** The toys the ask names (all connected ones when it names none). */
  targets: LightToy[];
  sends: { toyId: string; name: string; command: string }[];
  refused: { toyId: string; name: string; why: string }[];
}

/** Every toy the ask reaches and what each gets. */
export function planLight(command: { toyId?: string; light: ToyLightAsk }, toys: readonly LightToy[]): LightPlan {
  const ask = command.light;
  const targets = toys.filter((toy) => (!command.toyId || toy.toyId === command.toyId) && (!ask.toy || isAskedToy(ask.toy, toy)));
  const plan: LightPlan = { targets, sends: [], refused: [] };
  for (const toy of targets) {
    const picked = lightCommandFor(toy, ask.action, ask.which);
    if ('command' in picked) plan.sends.push({ toyId: toy.toyId, name: toy.name, command: picked.command });
    else plan.refused.push({ toyId: toy.toyId, name: toy.name, why: picked.why });
  }
  return plan;
}

function lightsLine(toys: readonly LightToy[]): string {
  return toys.map((toy) => `${toy.name} (${lightsFor(toy).join(', ') || 'no light commands'})`).join('; ');
}

function refusals(list: { name: string; why: string }[]): string {
  return list.map((r) => `${r.name}, ${r.why}`).join('; ');
}

/**
 * Plan the ask, send it toy by toy, and answer with what each toy did. The
 * answer carries no playing: a light changes nothing that plays, and a late
 * answer that said something was playing would be stopped by the house.
 */
export async function runLight(
  command: { id: string; toyId?: string; light: ToyLightAsk },
  toys: readonly LightToy[],
  send: LightSend,
): Promise<ToyRemoteAck> {
  const { id } = command;
  const action = command.light.action;
  const plan = planLight(command, toys);
  const result: ToyLightResult = { action, took: [], refused: [...plan.refused] };

  if (plan.targets.length === 0) {
    const asked = command.light.toy ?? command.toyId;
    return {
      id,
      ok: false,
      reason: 'no-toy',
      detail: toys.length === 0
        ? 'No toy is connected on their phone.'
        : `No connected toy is ${asked}. Connected: ${lightsLine(toys)}.`,
      light: result,
    };
  }
  if (plan.sends.length === 0) {
    return {
      id,
      ok: false,
      reason: 'no-toy',
      detail: `None of the toys asked has that: ${refusals(plan.refused)}. Connected: ${lightsLine(toys)}.`,
      light: result,
    };
  }

  const outcomes = await Promise.all(plan.sends.map((s) => send(s.toyId, s.command)));
  let held = false;
  plan.sends.forEach((s, i) => {
    if (outcomes[i] === 'ok') result.took.push(s);
    else if (outcomes[i] === 'held') {
      held = true;
      result.refused.push({ toyId: s.toyId, name: s.name, why: "the owner's stop is holding" });
    } else result.refused.push({ toyId: s.toyId, name: s.name, why: `the toy did not take ${s.command}` });
  });

  const tookLine = result.took.length ? ` ${result.took.map((t) => `${t.name} took ${t.command}`).join(', ')}.` : '';
  if (held) {
    return { id, ok: false, reason: 'held', detail: `The owner stop is still holding.${tookLine} The motors were not touched.`, light: result };
  }
  if (result.took.length === 0) {
    return { id, ok: false, reason: 'bad', detail: `No toy took it: ${refusals(result.refused)}.`, light: result };
  }
  const refusedLine = result.refused.length ? ` Not taken: ${refusals(result.refused)}.` : '';
  return { id, ok: true, detail: `Light ${action}:${tookLine}${refusedLine} The motors were not touched.`, light: result };
}
