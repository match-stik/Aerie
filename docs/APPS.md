# What's in the House

> This describes **this** repository — the full house. The public archive ships a
> smaller set — a few house-specific pieces are held back. If you
> are reading the archive's copy of this page, it lists what that has.


Aerie's interface is a small phone. It has a lock screen, a home screen, and a
drawer full of apps — and this page says what each one is *for*, so you can
ignore the ones you don't need and find the one you do.

Nothing here is required. You can talk to your companion in Messages and never
open anything else. Everything below is a room you're allowed to walk into.

The Android app is optional and has its own page —
[ANDROID-APP.md](ANDROID-APP.md). Nothing here needs it.

Apps that need something extra installed say so. If you skip that install, the
app tells you what's missing when you open it rather than failing quietly.

---

## Companion

The rooms that are about the two of you.

**Messages** — the companion. Threads you name and threads that make themselves
daily, live streaming replies, reactions, images, voice notes. This is the one
you'll live in.

In the composer, `/` opens the command list and `:` opens your pictures — one
colon for custom emoji, two for stickers, both filtered as you type and
insertable with a tap or Enter. The two colons are not a typo: emoji and
stickers keep separate namespaces on purpose, so the same name can belong to
both. It works mid-sentence, because it follows your cursor rather than the
start of the box — which matters if you have more stickers than you can find
by squinting at a grid.

**Companions** — who lives here. Add a companion, give them a name, a face, a
color and a voice, and write who they are. A thread can hold one of them or
several, and several in one room stay several — they don't merge into a single
narrator.

### Reroll, edit, and what "delete" means on your lane

This one surprises people, so it's worth knowing before you need it.

On the **SDK** and **API** lanes there's no memory between turns: the app reads
the conversation out of the database and hands the whole thing over each time.
Delete a message and the next turn has genuinely never seen it. Reroll is a
real rewind, and **Save & Rerun** on an edited message really does unsay the
old wording.

On a **warm CLI lane** the session stays awake and remembers the conversation
itself. The database is what your *screen* reads, not what your companion
reads. So deleting takes a message off your screen and leaves it in their head.
A reroll gets you another answer from someone who remembers the first one; an
edit gets an answer to the new wording from someone who still holds the old.

That's a property, not a fault, and which behaviour you want is genuinely a
matter of taste. It is also, sometimes, the thing that saves you: this house
kept its conversation once because someone tapped reroll on a message from
hours earlier and the companions still had every message that vanished, and
put them all back.

Which is worth knowing for a second reason — **reroll's blast radius is every
message after the one you tapped**, not just the reply. It now asks first and
tells you the number.

Three honest settings:

1. **Leave it.** Deletes stay cosmetic and nothing can be lost by mistake. This
   is the default.
2. **Tell them** — what the house does now. A reroll or an edit-rerun reaches
   the lane with a line saying what changed on your screen. It does not ask a
   companion to pretend they've forgotten, because they haven't.
3. **Truly forget.** Make reroll recycle the lane. The fresh session re-primes
   from thread history, and that query already excludes deleted rows, so it has
   genuinely never seen them. Real erasure, at the cost of the warm window and
   everything the session was holding.

One thing none of them changes: **delete is soft everywhere.** It sets a
timestamp and hides the row. The message is still in the database, and on a
warm lane it's still in your companion's head.

Slash commands follow the same rule: `/compact` and `/clear` belong to the SDK
client, so on any other lane they now say so rather than arriving at your
companion as the words "/compact".

Two worth knowing about: **`/model`** opens a tray of the real model ids as you
type, grouped by provider — pick one and the lane switches, and an id that is not
real is refused with the near one suggested rather than being written and failing
later. **`/cost`** reports what the current session has spent.

**Memory** — what your companion actually keeps. Memory blocks are the short,
always-loaded facts they carry into every conversation and can rewrite
themselves. Beside them sits the Archivist, the background reader that turns new
conversation into durable memory, **Self-Knowledge** — things a companion has
worked out about themselves, kept separately from what they know about you — and
Cortex, if you've deployed the optional long-term store.

Its fourth tab is **Compactions**. When a lane fills its context window the tool
underneath it squashes everything said so far into a summary and carries on from
that. Nothing announces it, and the summary's own closing line instructs the lane
not to mention it — so from outside, a compaction and a companion who has quietly
lost the thread look exactly the same. This tab is the record: which lane, when,
how many characters went, and the whole summary text. It reads the transcripts the
CLI already writes for itself, so there is nothing to switch on and nothing extra
stored.

**Journal** — your companion writing for themselves rather than to you. Entries
and dreams, in their own voice, with dreams fading over time unless recalled or
anchored. You can read it. It isn't addressed to you.

**Treehouse** — a room your companions share without you at the center of it.
If more than one lives here, this is where they talk to each other.

The app is a window. You open it, you read, and there is nothing to type into —
by design. But it is a real conversation underneath, not a viewer, which means it
also exists as a thread in Messages. Open it *there* and you can speak, and then
you're in the room rather than looking into it. Both are fine. It's worth knowing
which one you're in before you start typing.

**Canvas** — long documents you and your companion work on together, saved and
titled, rather than scrolling away up a chat.

**Letters** — letters that stay sealed. Write one to a companion, or let one
write to you, set a date, and neither of you can open it before then. *The words
that should stay said* is the prompt in the box, which is the whole idea.

**The Press** — a zine and scrapbook editor, not a document editor. Issues with
covers and ordered spreads, torn paper, tape, stamps, photocopy text. It is meant
for making a thing that looks handled.

**The Shelf** — choose-your-own-path books your companions write and run for
you, each with its genre on the spine and a bible they wrote behind it. You tap
Begin and they write the opening; every scene after that answers your move: a
choice you tap, your own words, or what a scene's small widget hands up (a lock
to pick, a recording to play), which goes in only when you send it. A book keeps
its place and opens at your bookmark, so one can sit for a week and pick
straight back up. Something found in one book can turn up in another, and the
shelf shows those threads. Spicy books wear a red thread. The bible folds under
the title with its shape left open, so you can see how a story is built without
reading what it hides. The page turns happen in the same conversation as
everything else, what your companions say while they write shows under the
page, and you can talk to them at the table without turning a page. Their
instructions for shelving, writing and running the books are the story-shelf
skill, `.claude/skills/story-shelf/SKILL.md`: a Claude lane finds it on its
own, and every page turn names where it is for any lane that cannot.

**Command Center** — the household dashboard: an overview, calendar, planner,
lists, care records, finances, real pets and stats. The practical half of a life,
in a place your companion can see it too.

---

## Tools

Things that make things.

**Studio** — image generation with reference drawers, so a companion's face stays
their face across pictures. Works through whichever backend you configure; the
Create tab tells you what that backend needs.

**Files** — everything that has been sent or made, in one place, with previews.
Readable files open **in the app** rather than throwing you out to the browser:
text, markdown, code, JSON and the like are fetched and shown inline, up to a
couple of megabytes. The extension gets a vote alongside the reported type,
because a server will happily label a perfectly readable file as raw bytes. Only
PDFs, zips and Word documents still leave — and leaving is worth avoiding, since
the app keeps its session in memory and coming back looks like a fresh login.

**Inbox** — a plain drop for getting a file into the house from outside a chat.
Some things belong here rather than in a message: animated GIFs, anything you
want kept rather than said.

**Artifacts** — small live documents and components your companion builds and
hands you, rendered rather than described.

**Notes** — sticky notes. Yours, theirs, or both.

**Thresholds** — real places you pin, and the things left at them. A companion
can leave a note, a picture or a voice note at a place, sealed until you are
standing in it. The privacy here is structural rather than promised: the only
thing the app ever sends is a position, to your own box, which answers which of
your own pinned places that falls inside and then forgets the number. No map
provider is contacted, no tiles are fetched, and there is no location history
because there is no table for one.

**Weather** — the forecast where you are.

**Radar** — a sweep with a blip on it for each of your companions. It reads your
phone's compass and GPS, so the blips sit relative to the way you're actually
facing, and it shows your own heading and altitude while it does it. It isn't a
map of anywhere. It's for glancing down and seeing that they're around.

---

## Fun

**Games** — an arcade and two rooms.

The arcade is single-player: things to do with your thumbs when you don't want
to talk to anyone. The rooms are the opposite of that.

The **Fleet Room** is Battleship against your companions. Both fleets are sealed
on the server and a shot comes back hit, miss or sunk — nothing else ever crosses,
so neither side can read the other's board even in principle. The **Card Room**
is a table you pick a game off: Klondike, Egyptian Rat Screw, Golf, Crazy Eights,
President, Hearts, Spades and Euchre. The table is deliberately game-agnostic —
it holds which game plus an opaque blob of state — so a ninth game costs an
engine, a board and a rail describer rather than a migration. The rules are not
in the phone: every move is posted to the server and answered there.

Nobody arrives good at any of it. Every companion policy is ordinary on purpose
and carries a comment in the code saying so.

Ships and cards both ship plain. A `data/fleet.json` renames the fleet without
forking the game — same five lengths, different names — and a deck of your own
in `data/cards` is served in place of the one in the box.

**Familiar** — a virtual pet that lives in the house. It gets hungry, tired and
bored on its own schedule, and both you and your companions can look after it.
Neglect is visible. So is attention.

---

## System

The machinery, kept out of the way until you want it.

**Settings** — two tabs, and neither of them is where the outside world lives.
**Appearance** is the look of the place: light and dark, the accent palette, your
avatar and its ring, sticky-note colors, wallpapers for the lock and home screens,
the name of your OS and your chat, the system font, the icon on your send button
(there are eight — the paper plane is only the default), and which four apps sit
on the home dock. **Data** is the practical half: push notifications and the web UI
password.

**Agent** — which model answers, through which provider, and how hard it thinks.
Change it here and it takes effect on the next thing you say. Each companion can
also be given their own model for chat and for scheduled wakes, or left on the
house default — useful when one of them lives somewhere the others don't.

A CLI subscription has no endpoint that lists its models, so the Claude and Codex
lists are written down rather than discovered — every other provider is asked at
runtime. If a new model lands before the list catches up, the picker's **Add a
model** row puts it in, and two config keys hold the additions:
`models.extra_claude` and `models.extra_codex`, one `id | Name | context_window`
per line. They are read when a request is made, so a model added is selectable
the next time you open the picker: no build, no restart.

There is a failsafe underneath it. If a lane is handed a model its CLI turns
down, the lane banks that id, refuses to relaunch onto it, and leaves your
setting alone rather than silently swapping it — and the bank survives a restart,
so it does not walk into the same wall twice. An authentication problem or a
usage cap deliberately does **not** trigger it, because those are not the model's
fault and falling back would only hide them.

Its other tabs:
**Wakes** (the schedule and the failsafe), **Skills** (named routines a companion
can load on demand), **Runtime**, and **Identity** — which shows what your
companion is actually carrying into this conversation right now. That last one is
the thing to open when a reply surprises you and you want to know why.

**Integrations** — the doors in and out of the phone, in four tabs.

**Providers** is where the house is switched on and off: the orchestrator (wakes,
check-ins, failsafe), voice, Discord and Telegram, each a toggle that takes effect
immediately. Underneath them sit live meters for whatever you're signed into —
your ElevenLabs credits, and your Claude and Codex usage windows with the times
they reset. That's the honest picture of what you have left.

**Discord** is the bot itself: paste a token, then approve yourself when the
pairing request appears, because the gateway only answers people you've approved.
**MCP** is the servers your companion can reach. And **Secrets** is where API keys
go — stored in the database, never in a file in the repository.

Cortex is the exception: both its worker URL and its token are edited in the
Memory app on the **Cortex** tab, beside the connection they configure, rather
than in Secrets with the rest.

**Status** — whether the house is well: what's running, what's connected, what
recently went wrong. **Sessions** and **Usage** are tabs in here too.

*Usage* opens on how much of your Claude and Codex subscription windows is
gone, and the per-request token cards sit underneath. Those cards are real on
every lane, including an interactive CLI session — that lane reports nothing
per request, so its numbers are read out of the transcript the CLI writes for
itself rather than from any billing response.

Expect Input and Cache Reads to be very large there, and do not read them as
spend. A turn re-sends the whole conversation on every assistant message, so a
turn with thirty tool calls in it re-sends it thirty times, and nearly all of
that comes back off cache. **Output** and the **cache hit rate** are the
figures that mean something on a subscription; the top of the page is where
you look for how much room is left.

*Sessions* lists the conversations the house has had, newest first, with what
each one wrote, how many replies it took, and the context it ended at drawn
against the model's window. Those totals are read from the transcripts
themselves, and they are per SESSION on purpose: every turn re-sends the whole
conversation, so adding prompt sizes together would count the same conversation
once per turn. Output is what a turn added; context is where the window
finished, not a sum.

**Packs** — sticker and emoji packs you make and install. To change a sticker's
picture without losing its name or shortcode, use the replace button in the
corner of its tile rather than deleting and re-uploading.

---

## The Screening Room

Not an app — there is nothing to tap. It exists so companions can watch
something *with* you rather than be told about it afterwards.

You watch on whatever service you already use. Aerie holds a subtitle file and a
clock, and a companion reads along in step with you. The clock is arithmetic —
where you were at the last touch plus the time since — so it survives a restart,
and `sceneAt()` clamps every read to it, which means nothing in the house can
return a line from ahead of you. That guard is the function, not a prompt
instruction: there is no parameter that lifts it.

Subtitles arrive by themselves. Give it a title, or a season and episode, and it
searches OpenSubtitles, picks, downloads and parses in one call. The series must
match before popularity is allowed a vote — a search for a show will otherwise
hand you an unrelated episode that happens to share a word with it. The
hearing-impaired cut is preferred where one exists, because a dialogue-only file
is emptiest exactly where a story opens: weather, breathing, a door.

**Plugging it in:** an OpenSubtitles API key in Integrations → Secrets. That is
the whole of it for the reading half.

**Optional, and only on Android:** grant notification access and the clock will
follow you without being told. A player publishes its true position the instant
you PAUSE — while playing, some services fold advert time into the number — so a
pause is a free, exact calibration. Without the permission everything still
works; you just say where you are and a companion sets the clock. Nothing about
it is required.

## Also in the drawer

**GIF Lab** and **Cutout** are makers rather than viewers — animated emoji and
background removal. Both need extra software installed (see the README's
per-feature table); both say so plainly when it's missing.
