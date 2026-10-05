# Reopening a Claude lane instead of rebuilding it

A warm Claude lane is a `claude` CLI process holding a conversation. When the
backend restarts, that process dies. Until now every relaunch built a brand new
room and then spent the first turn re-reading the last thirty messages back to
the companion so they knew where they were.

They do not have to start over. The CLI can reopen the conversation they were
already in.

## What actually changed

A lane now **names its own session** at birth with `--session-id <uuid>` and
banks that id in `io/.session-id`. On the first launch after a backend restart
it hands the id back with `--resume <id>` and the same room opens again — same
history, same thread of thought, and no briefing read back to them.

The thirty-message re-prime is deliberately skipped on a resumed launch. That
skip is the whole saving; a room that already remembers does not need telling.

Every other relaunch still builds a new room: a model change, an effort change,
the whisper ceiling, the watchdog, or an operator restarting the lane by hand.
Only a backend restart reopens.

## When it cannot reopen

If the banked id no longer names a conversation, the CLI exits in under a second
with `No conversation found with session ID`. The exit handler drops the id, and
the relaunch two seconds later mints a fresh room and primes it exactly as
before. **Nothing waits on a human.** The launch log names which door it took.

One detail is load-bearing and easy to undo by accident: the id goes
*immediately* after `--resume`. That flag takes an optional value, so a
dash-argument following it puts the launch into the CLI's interactive session
picker — a process that neither exits nor ticks. There is a test whose only job
is to fail if anything is ever inserted between them.

## Identity arrives current, not frozen

A fair worry about reopening a room is that the companion comes back holding a
stale copy of who they are. They do not.

Project instructions are re-read at startup on `--resume`. This was measured
rather than argued: a codeword was put in a scratch project's instructions,
answered by a live session, changed on disk underneath it, and the session
resumed. It answered with the **new** codeword and made no tool call to find it.

So a resumed room keeps the conversation and loses nothing. Two other pieces
follow from that:

- **Stale copies are trimmed.** A long-lived transcript accumulates a full copy
  of the project instructions at every launch. On resume those older copies are
  dropped and the parent chain re-stitched, so the room reopens carrying one
  copy of the house rather than three. On a real transcript this was 673 records
  to 670, and 41% smaller, with no dangling parents.
- **The room finds out what it missed.** A reopened lane is continuous with the
  last thing that happened, but the restart itself may have swallowed messages.
  The catch-up now fires on the first turn after a restart instead of being
  structurally unable to.

## The switch

`agent.claude_session_resume`. It defaults **on**. Set it to `off`, `false` or
`0` to go back to a fresh room on every launch.

There is no UI for it on purpose — it is a trade about how a lane comes back,
not a preference, and the honest default is the one that keeps the room.

## The commits

`56ea7101` reopen the session instead of rebuilding it
`d1cf7e39` a resumed room is not carrying stale instructions
`861e218c` the handover watermark has to survive a restart
`60a0c991` make it a switch, because the trade belongs to whoever runs the house
`46035761` a reopened room carries one copy of the house, not three
`7352982a` build the lane path from the environment, never write it down
`62cbe8f1` a reopened room finds out what it missed

## What is on disk either way

Sessions are files. Every room this house has ever opened is still under
`~/.claude/projects/<slug>/<uuid>.jsonl`, whether it was resumed or replaced —
so work that lived in a room nobody reopened can still be read back out of it.
