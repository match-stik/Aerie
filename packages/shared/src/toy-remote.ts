// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Lovense: this file drives Lovense toys. Running Aerie needs your own Lovense
// developer account and token; carrying this code into another project needs
// that project's own agreement and approval from Lovense. See
// packages/phone/android/LOVENSE.md.
// The road from a companion's lane to the owner's toys: the lane asks the
// house, the house hands the ask to the owner's phone over the socket, and the
// phone drives the toy through the same Lovense bridge the owner's own sliders
// use.
//
// The phone is where every rule that protects the owner is enforced, because
// it is the one place the owner's hands are. A command only reaches a toy
// after the owner has handed the remote over on the Toys page, never while
// the owner's own stop is holding, never while the screen is off, and never past its own end: every
// command carries the longest it may run, and the phone zeroes what it was
// driving there whatever happened to the lane or the house in between.

/** The longest one command may run. A longer scene sends again. */
export const TOY_REMOTE_MAX_MS = 180_000;
/** Steps shorter than this are stretched to it; a toy will not take more. */
export const TOY_REMOTE_MIN_STEP_MS = 200;
/** How long a plain level runs when the lane does not say. */
export const TOY_REMOTE_DEFAULT_MS = 30_000;
/** The top of every motor's level range, on every toy. */
export const TOY_REMOTE_TOP_LEVEL = 20;

/** One step of a track: hold this level for this many milliseconds. */
export type ToyStep = [level: number, ms: number];

/** What a lane can do with a toy's light. */
export type ToyLightAction = 'on' | 'off' | 'flash';

/**
 * A toy's two light pairs, as Lovense's SDK names them: light is LIGHT_ON and
 * LIGHT_OFF, which most toys list; alight is ALIGHT_ON and ALIGHT_OFF, the
 * README's "Domi/Domi 2 light", the pair the Toys page switches on a Domi.
 */
export type ToyLightPair = 'light' | 'alight';

/** A lane's light ask. It never touches a motor. */
export interface ToyLightAsk {
  action: ToyLightAction;
  /** One toy, by its id or the name GET shows; absent: every connected toy that has the light. */
  toy?: string;
  /** Which pair on and off use; absent: the phone picks from what each toy lists. */
  which?: ToyLightPair;
}

/** What the phone did with a light ask, toy by toy. */
export interface ToyLightResult {
  action: ToyLightAction;
  /** The toys whose SDK took the command, and the command each was sent. */
  took: { toyId: string; name: string; command: string }[];
  /** The toys that were asked and did not take it, and why. */
  refused: { toyId: string; name: string; why: string }[];
}

/** What the house hands the owner's phone. */
export interface ToyRemoteCommand {
  /** The house's id for this command; the phone answers with it. */
  id: string;
  /** The companion who sent it, by slug. */
  companion: string;
  /** When the house sent it. */
  at: string;
  /** play replaces whatever this lane had running; stop ends it; light
   *  switches a toy's light and leaves whatever is playing alone. */
  action: 'play' | 'stop' | 'light';
  /** The light ask, for action light. */
  light?: ToyLightAsk;
  /** One toy by id; when absent, every connected toy that has the motor. */
  toyId?: string;
  /**
   * Steps per motor. A key is a command name (FLEXER_FINGER), a motor's label
   * as the Toys page shows it ('fingering'), 'main' for each toy's first
   * motor, or 'all' for every motor it has.
   */
  tracks?: Record<string, ToyStep[]>;
  /** One of the toy's own patterns, 1 to 4, for presetMs. */
  preset?: number;
  presetMs?: number;
  /** How many times the steps play through. */
  loops?: number;
  /** The most this command may run. The phone stops it there regardless. */
  maxMs: number;
}

/** A motor the lane is driving right now. */
export interface ToyRemoteMotor {
  toyId: string;
  command: string;
  label: string;
  /** The level it is at this moment. */
  level: number;
}

export interface ToyRemotePlaying {
  companion: string;
  commandId: string;
  startedAt: string;
  endsAt: string;
  motors: ToyRemoteMotor[];
  /** The toy's own pattern, when that is what is playing. */
  preset?: number;
}

/** The phone's answer to one command. */
export interface ToyRemoteAck {
  id: string;
  ok: boolean;
  /**
   * Why not, in a word. closed: the owner has not handed the remote over, or
   * took it back. away: the screen is off or the app is behind something.
   * hands: the owner has the orbs open and is driving it by hand. held: the
   * owner's stop is still holding. no-toy: nothing connected that has that motor. no-bridge: this
   * phone cannot reach toys. bad: the command did not make sense to the phone.
   * Two come from the house instead: no-phone (the owner's app is not
   * connected at all) and no-answer (it was sent and nothing with a toy bridge answered).
   */
  reason?: 'closed' | 'away' | 'hands' | 'held' | 'no-toy' | 'no-bridge' | 'bad' | 'no-phone' | 'no-answer';
  /** One sentence the lane can act on. */
  detail?: string;
  /** What is playing once this command has been taken (null: nothing). A
   *  light answer never carries it, because a light changes nothing that plays. */
  playing?: ToyRemotePlaying | null;
  /** For a light command: toy by toy, what took it and what did not. */
  light?: ToyLightResult;
}

export interface ToyPhoneToy {
  toyId: string;
  name: string;
  /**
   * The level the toy itself last answered with, 0 to 100. Absent until it has
   * answered since their app started: never a default, and never the SDK's own
   * battery field, which Lovense only moves on an answer given while the toy
   * is still (so a toy running since it connected kept its unread 0).
   */
  battery?: number;
  /** When it answered. */
  batteryAt?: string;
  /** True when it answered while running, which Lovense says can read off. */
  batteryWorking?: boolean;
  motors: { command: string; label: string; max: number }[];
  /** How many of its own patterns it keeps (0 when it has none). */
  presets: number;
  /** The light commands it lists: FLASH, LIGHT_ON, LIGHT_OFF, ALIGHT_ON,
   *  ALIGHT_OFF. Absent when it lists none. */
  lights?: string[];
}

/** What the owner's phone tells the house about the toys, whenever it changes. */
export interface ToyPhoneState {
  at: string;
  /** This phone can reach toys at all. */
  bridge: boolean;
  /** open: the owner has handed the remote over. */
  gate: 'open' | 'closed';
  gateChangedAt?: string;
  /** Why it last closed: stop (the owner's stop, anywhere), red (the owner
   *  typed it), owner (the owner took it back), fresh (the app started; it
   *  always starts closed). */
  closedBy?: 'stop' | 'red' | 'owner' | 'fresh';
  /** The screen is off or the app is not in front. */
  away: boolean;
  /** The owner has the orbs open and is driving it by hand. */
  hands: boolean;
  toys: ToyPhoneToy[];
  playing: ToyRemotePlaying | null;
}
