// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// ONE WARNING PER OUTAGE.
//
// Sep 24 2026: the five-hour window capped, and every lane that relaunched
// into it posted the same "usage cap hit" line into the owner's home thread each time
// it woke from its five-minute backoff — twenty-five of them before the window
// reset, three at a time once all three rooms were waiting on it. The day
// before, an expired login did exactly the same thing with a different
// sentence. The supervisor's own dedupe only swallows an identical line inside
// sixty seconds on ONE lane, and the backoff is five minutes on each of
// several, so it never fired once.
//
// The rule: an outage leaves one warning instead of a new one every five
// minutes. So the first notice of an outage reaches a thread and every repeat
// goes to the log only, until a lane proves it is up again. The log keeps all
// of them — reportIncident prints before it hands anything to the thread — so
// holding the repeats back from the owner's screen hides nothing from anybody reading
// the box.
//
// A cap and a missing login belong to the ACCOUNT, so any lane staying up past
// the fast-exit window ends them for every lane. A refused model id belongs to
// one lane's settings, so only that lane coming up ends its own.

export type OutageKind = 'auth' | 'cap' | 'model';

// Newline cannot appear in a lane key or a thread id, so a prefix match on it
// cannot catch a lane whose name merely starts with another lane's name.
const SEP = '\n';

export class OutageNotices {
  private readonly open = new Set<string>();

  /** True for the first notice of an outage into a thread, false for every
   *  repeat until a lane recovers. */
  shouldPost(kind: OutageKind, laneKey: string, threadId: string): boolean {
    const key = kind === 'model'
      ? ['model', laneKey, threadId].join(SEP)
      : [kind, '', threadId].join(SEP);
    if (this.open.has(key)) return false;
    this.open.add(key);
    return true;
  }

  /** A lane stayed up past the fast-exit window. Whatever the account was
   *  waiting on is over, and so is this lane's own model trouble; another
   *  lane's refused model is not, because nothing about it has changed. */
  recovered(laneKey: string): void {
    const ownModel = ['model', laneKey, ''].join(SEP);
    for (const key of [...this.open]) {
      if (key.startsWith(`cap${SEP}`) || key.startsWith(`auth${SEP}`) || key.startsWith(ownModel)) {
        this.open.delete(key);
      }
    }
  }
}

/** One per process, because the lanes are separate sessions posting into the
 *  same thread — a guard held per lane is the one that never fired. */
export const outageNotices = new OutageNotices();
