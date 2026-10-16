// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Which sliders a Lovense toy gets, from the command names its SDK reports.
// Kept free of imports so it can be tested without the app around it.

/** The motors a page can offer for a toy, in the order they should appear,
 *  each with the command that drives it and its top level. */
export interface ToyMotor {
  command: string;
  label: string;
  max: number;
}

/** The motors a toy's command list adds up to. Lovense lists overlapping
 *  commands for one motor (the Flexer answers to VIBRATE1 and VIBRATE2 and
 *  to its own FLEXER_VIBRATE and FLEXER_FINGER), so the most specific set
 *  wins rather than every command getting a slider of its own. */
export function motorsFor(toy: { commands: readonly string[] }): ToyMotor[] {
  const has = new Set(toy.commands);
  if (has.has('FLEXER_FINGER')) {
    return [
      { command: 'FLEXER_VIBRATE', label: 'Vibration', max: 20 },
      { command: 'FLEXER_FINGER', label: 'Fingering', max: 20 },
    ];
  }
  if (has.has('VIBRATE1') && has.has('VIBRATE2')) {
    const numbered: ToyMotor[] = [
      { command: 'VIBRATE1', label: 'First motor', max: 20 },
      { command: 'VIBRATE2', label: 'Second motor', max: 20 },
    ];
    if (has.has('VIBRATE3')) numbered.push({ command: 'VIBRATE3', label: 'Third motor', max: 20 });
    return numbered;
  }
  const motors: ToyMotor[] = [{ command: 'VIBRATE', label: 'Vibration', max: 20 }];
  if (has.has('VIBRATE1')) motors.push({ command: 'VIBRATE1', label: 'Second motor', max: 20 });
  if (has.has('THRUST')) motors.push({ command: 'THRUST', label: 'Thrust', max: 20 });
  if (has.has('ROTATE')) motors.push({ command: 'ROTATE', label: 'Rotation', max: 20 });
  if (has.has('OSCILLATE')) motors.push({ command: 'OSCILLATE', label: 'Oscillation', max: 20 });
  // UNTESTED: no toy that has this has ever been in the house. The Max's air
  // pump, as Lovense's SDK names it (AIR_AUTO, 0 to 3), which the phone's
  // bridge already sends and already zeroes on a stop; a level asked above 3
  // is held at 3. Added so a house with one gets a slider instead of nothing
  // (the owner's ask, Oct 26 2026: 'adding it and the note that they're
  // untested is best'). Lovense's support table (Android SDK page, read
  // Oct 26 2026) lists THRUST for the Solace, so a Solace already gets the
  // Thrust slider above; SOLACE, thrust with a depth of 1 to 3, has no
  // column in that table at all, so whether a Solace reports it is not known. The Solace Pro's SPEED (speed,
  // start and end, each 0 to 20) and SET_SITE (a position, 0 to 100) are
  // documented, and are left out until the bridge sends them, which takes a
  // new app build.
  if (has.has('AIR_AUTO')) motors.push({ command: 'AIR_AUTO', label: 'Pump (untested)', max: 3 });
  return motors;
}

/** How many of its own patterns a toy keeps. The SDK sends Preset:N straight
 *  to the toy, and its README's 1 to 10 is the range the command accepts, not
 *  what a toy holds. Lovense toys keep four: the cloud bridge names them pulse,
 *  wave, fireworks and earthquake, and on a Flexer Preset 1 to 4 answered
 *  while 5 to 10 sat still, four matching the four patterned
 *  modes its own button clicks through after its three steady levels. */
export function presetsFor(toy: { commands: readonly string[] }): number {
  return toy.commands.includes('PRESET') ? 4 : 0;
}
