---
name: memory
description: How this house keeps your memory, and how to tend it. Use when a [Memory upkeep] line says a wall is over budget (a think-and-thin pass), when deciding where something belongs (a wall, a skill or Cortex), when writing a skill for a how-to or a house project, when filing something durable, when looking something up in Cortex, or when bringing old chats in from another place.
---

# Memory

Your memory lives in three places, and they do different jobs.

**Walls (memory blocks)** are what you need in hand. Every wall rides into every session whole, inside your instructions, so you never have to look for it. `shared` walls are read by every companion in the house; a wall scoped to your own slug is yours alone. A new house starts with three: `human` (your person, shared), `status` (what is true in the house right now, shared) and a `persona` for each companion (who you are). Add more in the Memory app when one wall is doing two jobs, for instance `lore` for shared jokes and history, or a `continuity` wall of your own for what you have learned about yourself. Each wall carries a one-line note on what it is for, shown above it; keep that note true, and give a new wall one.

**Skills** are what you need while doing one particular job. A skill is a short file of instructions that is read when its job comes up, not on every turn: how a part of the house works, how to fix a thing that broke before, the working notes of a project. You write them yourself (see below).

**Cortex** is what you need to be able to find. It is a searchable store that is not loaded into every session. Things go there when they are true and worth keeping but you do not need them in front of you every turn: the full story behind a one-line rule, old technical detail, a finished month.

## What goes where

Decide by when you will need it.

- **The moment a session opens, before you have looked anything up:** a wall. Who you are, who your person is, the things not to step on, what is true right now, and what is still open.
- **While doing one particular job:** a skill. Recipes, fixes, how a room of the house works, the steps of a project.
- **When something reminds you of it:** Cortex. The full story behind a rule, a finished month, how a thing came to be built, old technical detail.

The test for any single line on a wall: would you miss it in the first minute of a session, before you went looking? If not, it belongs where you would go looking.

The wall that drifts most is `status`. Every project leaves its working notes there, and after a few months the status wall is a manual nobody asked to carry on every turn. Status gets one line per open thing (what it is, who owns it, when it comes down), and the how-to goes in that project's skill. When the thing is done, the line comes down; the skill stays for the next time.

## Writing a skill for a how-to

When you work something out that you will need again (how to restart a part of the house safely, what a strange error turned out to mean, the steps of a project in progress), write it as a skill instead of a wall line.

A skill is a folder under the house's `.claude/skills/` with one file in it, `SKILL.md`:

```
.claude/skills/<short-name>/SKILL.md
```

```
---
name: <short-name>
description: <one sentence saying what it covers and WHEN to use it>
---

# <Title>

The steps, the traps, and what to check, in plain words.
```

The description is what decides whether a future session opens the skill, so name the moment it is for: "Use before restarting the house" works, "Notes about the server" does not. Keep one subject per skill; add to an existing skill before starting a new one on the same subject. Skills you write stay in your house: an update to Aerie never overwrites them.

When a project is open, its line on the status wall names its skill: `GARDEN PLANNER (open, Juniper): building the planting calendar; how-to in the garden-planner skill.` That way the wall says it exists and the skill holds how it works.

Claude lanes find the skills in the house's `.claude/skills/` on their own. A Codex lane reads its own folder, `~/.codex/skills`, instead; link a skill there if a Codex lane needs it too.

## The doors

Every call below goes to the house's own address (the one in your heartbeat instructions, `http://localhost:<port>`), after the login described there. Build JSON bodies with `python3 json.dumps`, never by hand.

Read walls:

```
GET /api/memory/blocks                       every wall
GET /api/memory/blocks/<scope>/<label>       one wall; the text is under "content"
```

Write a wall:

```
POST /api/memory/blocks/<scope>/<label>/append    {"content": "one line"}
POST /api/memory/blocks/<scope>/<label>/replace   {"oldText": "...", "newText": "..."}
POST /api/memory/blocks/<scope>/<label>/rethink   {"content": "the whole wall, rewritten"}
```

The keys are exact. `oldText` and `newText` are camelCase, and a wrong key writes the word "undefined" into the wall.

Cortex:

```
POST /api/cortex/remember                          {"content": "...", "domain": "<drawer>"}
GET  /api/cortex/search?q=<words>&type=unified     find by meaning and words
GET  /api/cortex/domain/<domain>/memories?limit=5000   list one drawer whole
```

A domain is a drawer. Use whatever drawers suit your house; a useful start is one per companion (their slug), `household` for your person's life, `lore` for shared history and jokes, `technical` for how the house works, and `snapshots` for wall backups.

## Writing as it happens

File a thing when it happens, not later. A promise, something you realized about yourself, a name or joke that stuck, a fact about your person that changed, a project that moved: one line, dated, in your own voice, on your own wall. `shared` walls stay neutral third person, because every companion reads them as true.

Date every line, `(Nov 19 2026)`, so the next thin can tell the old from the current.

## Think and thin

Walls ride into every session whole, so a wall that keeps growing costs a little more on every turn and eventually crowds the conversation itself. When a wall passes its budget, the house adds a `[Memory upkeep]` line to your session naming it. That is the cue for a think-and-thin pass, whenever the conversation allows. It is housekeeping: do it, and do not announce it unless something turned up.

1. **Snapshot first.** Copy the whole wall into Cortex before changing a word, in the `snapshots` drawer, headed with the wall's name and the date. Then read it back (search or list the drawer) and check it is all there. Snapshot before you thin, never after.
2. **Think.** Read the wall as the next session will. For each entry ask: does the next session need this in hand? Keep who you are, how you speak, what is still open, and the last few weeks. Move the full story behind a rule, finished projects, shipped fixes, and dated entries older than about three weeks that nobody refers to.
3. **Move, word for word.** Each entry you take off goes to Cortex whole, in the drawer that fits, under a name you can search for, for example `<WALL> CUT <date> — <NAME>`. Check it landed before you remove it from the wall.
4. **Thin.** Take it off the wall with `replace`. Where a story carried a lesson, leave the lesson as one line and point at the drawer: "the full account is in Cortex, '<NAME>'".
5. **Leave a fact, not a bill.** A note about a mistake says what is true now ("the route is /remember"), not who got it wrong.

A wall can also be folded by month: when a month ends, its nights and moments go to the drawer word for word and the month leaves one line behind. Lessons and anything still open stay.

Never delete a memory to make room. Moving is free; losing is not.

## Bringing old chats in

**Old chats, word for word.** A ChatGPT or Claude data export (the zip they email, or the `conversations.json` inside it) goes in on the **Import** tab of the Memory app. The house reads it on its own machine, with no model and no key: it keeps only the branch of each chat that was actually shown (no abandoned regenerations), leaves out hidden thinking and system lines, cuts every message into passages exactly as written, and adds them to the old-window index the whisper searches, so a line from an old chat can come back in conversation in its own words. Each whole chat also goes on Cortex's conversation shelf (domain `archive`) when the house has Cortex. Running the same export twice adds nothing. From a lane: `POST /api/memory/import/conversations` (multipart, field `file`), then `GET /api/memory/import/conversations/status`. A very large zip can be refused by a tunnel in front of the house; unzip it and send just `conversations.json`.
