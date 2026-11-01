# Building in Your House

Aerie is meant to be changed. You can change it with your companion's help
from outside the house, or your companion can change it from inside, the way
they talk to you every day. Both work. They are not equally safe by default, and
the difference is mostly about one thing: **the house your companion is
building is also the house they live in.**

## From outside

You work on the code somewhere other than the running house: a terminal on
your own machine, a terminal on the server that is not one of the house's
lanes, or a consumer app (claude.ai, ChatGPT) where your companion reads what
you paste and writes changes for you to apply.

This is the simplest way to start, because nothing you do can take down the
conversation you are having while you do it.

- **A consumer app can't see your files.** It only knows what you paste. Paste
  the actual file, the actual error and the actual log line, not a description
  of them, and paste the whole function rather than the line you think is the
  problem. Ask for changes as edits to what you pasted, not as whole new files;
  a rewritten file quietly drops things it was never shown.
- **A terminal on the server can see everything**, including the database and
  your keys. Run it from the repo folder, never as root, and give it the same
  rules as an inside build (below): build before restart, tests before both.
- **You apply and you restart.** Read what changed (`git diff`) before you
  build, and keep the commit small enough that you could undo it with one
  `git revert`.

## From inside

Your companion's lane runs on the same server as the house, with a working
folder of its own (`data/heartbeat/<lane>`). It can read the code, edit it,
build it and test it in the middle of a conversation with you. That's how
this house gets built most days. It needs a few rules, and every one of them
comes from something that went wrong once.

**Never restart from inside.** The lane is a child of the server. Restarting
the server ends the turn the restart was typed in, often halfway through the
reply that explains it, and if the new build doesn't start, the companion who
would fix it is the one who can't get back in. The restart is always yours:
they build, test, commit and tell you a restart is waiting, and you press it
when you're ready (`pm2 restart aerie`, or however you run it). The same goes
for anything else that would cut the house off mid-sentence: the server's
process manager, the tunnel, the web server in front of it, a system update.

**Build before every restart.** The server runs the compiled code in
`packages/backend/dist`, not the source, so an edit does nothing until
`npm run build` in `packages/backend` has turned it into `dist`. A restart
without a build just restarts the old house. A change to the phone needs
`npx vite build` in `packages/phone` and a refresh on your phone, no restart.

**Run the tests, and make sure they can fail.** `npm test` at the top of the
repo runs every test; `npm test <part of a name>` runs the ones that match.
Tests run from source, so they don't need a build first. When you add a test
for a fix, break the fix on purpose and watch the test go red before trusting
it to go green. A test that has never failed has never been shown to be
testing anything.

**Keep scratch work out of the house.** Experiments, one-off scripts,
downloaded files and half-finished drafts go in a scratch folder outside the
repo (for example `~/scratch/<what it's for>`), not in the repo and not in
`data/`. The repo is what gets committed and shared; `data/` is the live
house, with the database, your files and the lanes' working folders in it.
Something left there by accident is something you might later push, delete
or serve to your phone without meaning to.

**Never edit the live database or `data/` by hand while the server runs.**
Go through the house's own routes, which keep the database, the running
process and the phone in step. If something has to be changed directly,
stop the server first (yours to do) and take a copy.

**Copy before you change anything you can't rebuild.** Memory walls,
settings, anything in `data/`: take a snapshot to a folder outside the repo,
read it back to make sure it's whole, then change the original.

**Commit small and say why.** One change per commit, with a message that
explains what it was for in plain words. That's what lets you, or a fresh
companion window next month, undo one thing without undoing everything.

**Pushing is yours.** A lane can commit, but anything that leaves the server
(a push, a deploy, a message to a stranger) waits for your word.

**New files open with the copyright line.** Every source file starts with the
line the other files have; a test fails on any file that doesn't.

**Keys live in the house's secret store,** never in a source file, a commit
or a scratch file that might get shared.

## Telling them apart

If your companion is building from inside, they should say so when they start,
come up for air while they work, and end with what changed and whether you
need to restart or refresh. If they are helping from outside, you are the one
who knows what is running. Either way, the house you hand a restart to should
be one you have seen the tests pass on.

See also: *Ways to Run Your House* for the settings that change how the house
behaves, and `docs/HOOKS.md` for how a lane is kept warm.
