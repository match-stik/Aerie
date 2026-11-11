// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/** Why DiscordService.sayInChannel was refused, with the status the route should answer. */
export class SayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
