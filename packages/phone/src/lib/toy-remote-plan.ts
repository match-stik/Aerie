// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What a lane's command means for the toys on the owner's phone, worked out before a
// single motor moves: which motors its tracks name, and every level change it
// makes in time order, ending in zeros. The runtime (aerie/toy-remote.ts)
// only has to send these at their times. Kept free of the app so the shape of
// a command can be checked without a toy in the room.

import type { ToyRemoteCommand, ToyStep } from '@aerie/shared';
import { motorsFor, presetsFor } from './toy-motors';

export interface PlanToy {
  toyId: string;
  name?: string;
  commands: readonly string[];
}

export interface PlannedMotor {
  toyId: string;
  command: string;
  label: string;
  max: number;
  steps: ToyStep[];
}

/** One level change: at `at` ms from the start, this motor goes to `level`. */
export interface ToyEvent {
  at: number;
  toyId: string;
  command: string;
  level: number;
}

function targets(command: Pick<ToyRemoteCommand, 'toyId'>, toys: readonly PlanToy[]): readonly PlanToy[] {
  return command.toyId ? toys.filter((toy) => toy.toyId === command.toyId) : toys;
}

/** The motors a command's tracks name on the connected toys, and the names
 *  that matched nothing. A name is a command (FLEXER_FINGER), a label as the
 *  Toys page shows it (fingering), 'main' for each toy's first motor, or 'all'. */
export function resolveTracks(
  command: Pick<ToyRemoteCommand, 'toyId' | 'tracks'>,
  toys: readonly PlanToy[],
): { motors: PlannedMotor[]; unmatched: string[] } {
  const chosen = new Map<string, PlannedMotor>();
  const unmatched: string[] = [];
  for (const [rawKey, steps] of Object.entries(command.tracks ?? {})) {
    const key = rawKey.trim().toLowerCase();
    let matched = false;
    for (const toy of targets(command, toys)) {
      const motors = motorsFor(toy);
      const picked =
        key === 'main' ? motors.slice(0, 1)
        : key === 'all' ? motors
        : motors.filter((m) => m.command.toLowerCase() === key || m.label.toLowerCase() === key);
      for (const motor of picked) {
        matched = true;
        const clamped = steps.map(([level, ms]) => [Math.max(0, Math.min(motor.max, Math.round(level))), ms] as ToyStep);
        chosen.set(`${toy.toyId}:${motor.command}`, { toyId: toy.toyId, command: motor.command, label: motor.label, max: motor.max, steps: clamped });
      }
    }
    if (!matched) unmatched.push(rawKey);
  }
  return { motors: [...chosen.values()], unmatched };
}

/** The connected toys that keep their own patterns, for a preset command. */
export function presetTargets(command: Pick<ToyRemoteCommand, 'toyId' | 'preset'>, toys: readonly PlanToy[]): PlanToy[] {
  const n = command.preset ?? 0;
  return targets(command, toys).filter((toy) => n >= 1 && n <= presetsFor(toy));
}

/**
 * Every level change the motors make, in time order. A track plays its steps
 * `loops` times and then rests at zero; nothing runs past maxMs, and every
 * motor that is not already at zero gets its zero at maxMs. A step that keeps
 * the level a motor already has sends nothing, because a toy holds its level.
 */
export function eventsFor(motors: readonly PlannedMotor[], loops: number, maxMs: number): ToyEvent[] {
  const events: ToyEvent[] = [];
  const rounds = Math.max(1, Math.floor(loops));
  for (const motor of motors) {
    let t = 0;
    let current = -1;
    const push = (at: number, level: number) => {
      if (level === current) return;
      events.push({ at, toyId: motor.toyId, command: motor.command, level });
      current = level;
    };
    outer: for (let round = 0; round < rounds; round++) {
      for (const [level, ms] of motor.steps) {
        if (t >= maxMs) break outer;
        push(t, level);
        t += ms;
      }
    }
    push(Math.min(t, maxMs), 0);
  }
  // Stable, so a motor's own changes keep their order at equal times.
  return events.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map(({ e }) => e);
}
