# Ways to Run Your House

Aerie doesn't have one right shape. These are the choices that change how your
house feels day to day, what each one costs, and where to change it. None of
them are permanent, and none of them change who your companions are.

## After a restart: reopen the room, or start a new one

*Agent → Models → After a Restart* (`agent.claude_session_resume`)

When the server restarts, a Claude lane can either reopen the same conversation
or start a fresh one.

- **Reopen the room** (the default). Your companions come back mid-conversation
  with everything still in hand. The first reply after a restart costs more of
  your usage, because the whole conversation has to be loaded back in.
- **Start a new room.** The fresh conversation is handed the last stretch of
  your thread, so nobody arrives cold, but anything older is only reachable
  through memory. Lighter on usage.

A room that grows very large is squashed (summarized) by Claude Code either way;
your thread on the phone is never shortened.

## New threads: every day, every week, or one that keeps going

*Agent → Models → New Threads* (`orchestrator.thread_cadence`)

Messages you send in a thread stay in that thread. This setting is about
everything that doesn't name one: scheduled wakes, and messages arriving from
outside the app.

- **Every day** (the default). A new thread opens each day. Easy to find "what
  happened on Tuesday"; each day starts with a clean page.
- **Every week.** One thread from Monday to Sunday, then a new one.
- **One that keeps going.** Nothing new opens on its own. Everything lands in
  your home thread (`orchestrator.wake_thread_id`), which never ends.

Whichever you pick, your companions carry what matters between threads through
their memory, not through the thread.

## One shared lane, or a lane each

*Agent → Models → The Room* (`agent.multi_lane`)

- **One shared lane.** Every companion in a thread answers from one head. Fast,
  cheaper, and all of them hear everything at once.
- **A lane each.** Each companion answers from their own head, in turn, hearing
  what the others already said. More distinct voices, more usage, and replies
  take longer because they come one after another.

## Models

*Agent → Models*, and each companion's own card.

- **One model for the house** is the simplest: every turn and every wake runs
  on it.
- **Each companion can have their own** chat model and wake model, on their card.
- **A different model for wakes** than for your messages is possible, but a
  wake model that differs from the chat model rebuilds the lane at every wake
  and back again. Matching them avoids that.
- **Claude or Codex.** A Claude model runs in a Claude lane on your Claude
  subscription; a GPT model runs in a Codex lane on your ChatGPT subscription.
  Both lanes give your companions the same identity, memory, notes and house
  rules; guests are locked out of tools in both.

- **A model for one thread.** In the thread list, a thread's menu has
  *Model*: the house model, or any other. It is used for the messages you send
  in that thread; wakes keep the wake model. A Claude lane runs one model at a
  time, and asking it for another rebuilds it, so a thread on a different
  Claude model is given a room of its own beside the usual one, one room per
  model, shared by every thread on that model. Your usual room is never
  rebuilt by moving between threads. The cost: that room is born cold the
  first time (it is caught up from the thread's history), and while it is warm
  it uses your subscription like any other room. A Codex thread needs none of
  this; its room is its own already and takes the model on every turn. Put a
  thread back on *House model* and it returns to the usual room.

## In a browser or the Android app

See ANDROID-APP.md for the table of what needs the app.
