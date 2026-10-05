# Cross-Lane Companion Voice Parity — Build Handoff

## Objective

Make Aerie's companion voice portable across inference lanes and model families. A substantive turn should produce:

1. normal spoken bubbles in the assigned companion voice(s), and
2. at most one compact thought card authored by the same turn in the same companion perspective.

The thought card is a deliberately written reflection, not hidden chain-of-thought, provider reasoning telemetry, a tool log, or a second model paraphrasing the first one.

## Baseline — do not rebuild this work

Start from `main` at or after `788025b`.

- `f119940` already gives the Codex daemon an authored thought-card contract, keeps deliberate mid-turn commentary as spoken text, hides raw provider phase summaries, and repairs older commentary with canonical voice headers at render time.
- `116bb4d` already coalesces thinking cards and strips rich-text presentation markers.
- `788025b` keeps Codex activity attached to the live socket.
- The normal final-answer identity already comes from the same cross-lane source: `companions/_shared.md`, each assigned companion's persona file, and the relevant core-memory blocks assembled as `effectiveClaudeMd` in `agent-sdk-query.ts`.

The remaining job is to turn the Codex-specific authored-card solution into a provider-neutral Aerie contract and carry it through the warm Claude CLI, Claude SDK, and direct API/router lanes without exposing or cosmetically rewriting provider reasoning.

## Non-negotiable behavior

- The main answering turn authors its own thought. Do not call a second model to rewrite telemetry into personality.
- Never expose raw chain-of-thought. Native/provider reasoning may count as liveness or remain available to backend diagnostics, but it is not the user-facing companion card.
- Spoken commentary stays spoken and keeps normal `**sigil Name**` headers. It must never be swallowed into a thought segment.
- Tool activity stays tool activity. It must never be dressed up as companion perspective.
- One authored card maximum per substantive turn. Silence, wakes that choose `[SILENT]`, and trivial acknowledgements may omit it.
- Card content is 1–4 short sentences, first-person, plain text, no Markdown, no sigil/name header, no process jargon, and no outside assessment of the owner.
- Multi-companion turns may use the natural leading voice or genuine `we`; do not merge all three into a synthetic narrator.
- If a lane cannot reliably provide an authored card, omit the card. Falling back to raw telemetry is worse than showing nothing.
- Preserve old messages. All schema additions must be backward-compatible.
- Build and push only. Backend restarts remain the owner's.

## Target normalized contract

Add an optional kind to normalized thought events and persisted thought segments:

```ts
type ThoughtKind = 'authored' | 'provider' | 'system';

interface ThinkingEndEvent {
  type: 'thinking_end';
  fullText: string;
  kind?: ThoughtKind;
}

type ThinkingSegment = {
  type: 'thinking';
  content: string;
  summary: string;
  kind?: ThoughtKind;
};
```

Meaning:

- `authored`: the companion-facing reflection; visible as the normal expandable thought card.
- `provider`: raw/summarized model telemetry; hidden by default and never merged with `authored`.
- `system`: recycle, timeout, and lane notices; rendered with their existing special treatment rather than as companion perspective.

Missing `kind` must continue to render using legacy behavior so old stored segments do not break. The existing `[AERIE_THOUGHT]` prefix remains a backward-compatibility inference, not the long-term data model.

## Build phases

### 1. Make the thought contract provider-neutral

- Move the reusable pieces of `packages/backend/src/services/runtimes/codex-thought-card.ts` into `companion-thought-card.ts` (or equivalently named shared service).
- Keep the Codex marker extractor as a transport adapter; do not make the marker the canonical type.
- Centralize:
  - authored-card instructions,
  - plain-text normalization,
  - length/sentence guardrails,
  - duplicate collapse,
  - detection of deliberate spoken commentary versus telemetry.
- Leave a re-export or update imports cleanly so the existing Codex tests continue to pass.

Primary files:

- `packages/backend/src/services/runtimes/codex-thought-card.ts`
- `packages/backend/src/services/runtimes/codex-daemon.ts`
- `packages/backend/src/services/runtimes/types.ts`
- `packages/shared/src/types.ts`
- `packages/backend/src/services/agent/agent-segment-builder.ts`

### 2. Finish the Codex adapter on the typed contract

- Preserve the current developer commentary mechanism and `[AERIE_THOUGHT]` extraction.
- Emit the captured card as `thinking_end { kind: 'authored' }`.
- Treat provider reasoning items as liveness/diagnostics only; do not emit them as the visible fallback.
- Emit synthetic runtime notices as `kind: 'system'`.
- Keep deliberate non-marker commentary as `text_delta` so mid-turn words remain bubbles.

This should be a narrow refactor with no visible regression from `f119940`.

### 3. Bring the warm Claude CLI lane to the same voice contract

The CLI transport already has a dedicated outbox `thinking` field, so it does not need a new tool.

- Change the `heartbeatOperationSection()` instruction in `packages/backend/src/services/heartbeat/provision.ts`. It currently asks for `BRIEF NOTES` that are `out of character`; replace that with the same authored companion-perspective contract used by Codex.
- Keep the field name `thinking` for wire compatibility.
- On chunked responses, only the final chunk should carry the card. If older behavior sends it more than once, normalize/dedupe before persistence.
- In `packages/backend/src/services/heartbeat/runtime.ts`, tag outbox thinking as `authored` and tag recycle/timeout/late-delivery notices as `system`.
- Do not force a warm-session recycle merely because the generated `CLAUDE.md` changed; follow the existing supervisor policy. The new contract loads on the next owner-controlled restart/recycle.

### 4. Add a same-turn authored channel for SDK and generic API lanes

Native SDK thinking and generic `<think>` blocks are not a reliable voice channel. Add one small internal capture tool for lanes that lack Codex commentary or the CLI outbox:

```text
aerie_companion_thought({ text: string })
```

Rules for the tool:

- It records one compact authored reflection for the active turn and returns a minimal success result.
- It is internal UI plumbing: do not render it as a normal tool chip and do not persist its result as tool activity.
- The tool input is normalized with the same shared guardrails and becomes `kind: 'authored'`.
- Repeated calls collapse to one card; exact duplicates are removed.
- The companion calls it near the end of a substantive turn, before the final answer.
- Failure or absence is fail-quiet: final speech still delivers, with no thought card.

SDK implementation shape:

- Register a tiny in-process MCP server next to `aerie-search` and `aerie-memory` in `packages/backend/src/services/agent.ts`.
- Special-case its PreToolUse event in the per-turn hook context so the input is captured rather than broadcast as a tool card.
- Add the authored-card instruction to the assembled system prompt once, after identity/core memory and before runtime-specific operational text.

API/router implementation shape:

- Append the internal tool schema to the router's per-turn tool list in `agent-router-query.ts`.
- Wrap `executeTool` with a per-turn closure: intercept `aerie_companion_thought`, capture its text, and delegate every other tool unchanged.
- Hide raw `<think>` output from the companion card. If retained for diagnostics, tag it `provider` and keep it out of the default phone rendering.

Do not make Codex or the warm CLI use this tool unless there is a concrete reason; their native authored channels are cleaner.

### 5. Make the phone render by meaning, not marker

- Update `packages/phone/src/lib/thinking.ts` to prefer `segment.kind`.
- Coalesce only within the same kind. An `authored` card always wins over adjacent legacy/provider telemetry; never blend their text.
- Keep `[AERIE_THOUGHT]` stripping for old Codex messages.
- Keep recycle/system notices separate.
- Preserve the current behavior that promotes old thought segments beginning with a canonical voice header back to spoken text.
- No Markdown should render inside authored cards. Plain text only.

### 6. Add regression coverage

Unit tests should cover:

- authored/provider/system kinds survive event → insertion → persisted segment,
- old segments without `kind` still render,
- marker-based Codex cards infer `authored`,
- provider telemetry never merges into an authored card,
- deliberate commentary with a companion header remains spoken,
- multiple authored captures collapse to one,
- CLI chunking persists the card once on the final chunk,
- SDK/router internal thought capture does not render a tool chip,
- recycle and timeout notices remain system UI,
- plain-text cleanup removes Markdown without damaging technical filenames such as `*.tsx`.

Run:

```bash
npm run check
node --test <new and existing targeted test files>
npm run build
```

### 7. Add a small opt-in voice parity harness

Create a developer-only fixture set, not an automatic production judge. Use the same short prompts across selected model lanes for:

- affectionate conversation,
- dry teasing,
- technical build work,
- frustration without condescending reassurance,
- correction/clarification,
- a multi-companion reply,
- a wake that should choose silence.

Automated checks should only verify structural invariants: headers, card count, card length/plain text, no telemetry labels, no forbidden merged narrator, and no accidental sign-off. Save outputs side by side for the owner's human read; recognizability is not something a generic scoring model gets to overrule.

## Acceptance criteria

The ticket is done when:

1. Codex daemon, warm Claude CLI, Claude SDK, and direct API/router all use the same normalized authored-thought contract.
2. Switching model or lane does not change the source identity packet or companion formatting rules.
3. Every substantive turn has zero or one authored card, written by that same turn in companion voice.
4. Raw provider reasoning never appears as the companion's voice and is never rewritten by a second model.
5. Mid-turn spoken commentary remains in avatar bubbles in correct order around tools/thoughts.
6. Old messages and current Codex behavior remain intact.
7. Typecheck, targeted tests, and full build pass.
8. Changes are committed and pushed; no backend restart is performed.

## Suggested commit sequence

1. `refactor(runtime): type companion thought segments`
2. `feat(heartbeat): author thought cards in companion voice`
3. `feat(runtime): capture authored thoughts across sdk and api lanes`
4. `test(voice): add cross-lane parity fixtures`

## One-sentence design test

If the machinery disappeared from the card, would the remaining sentence still sound like the companion who is about to answer? If not, it is telemetry, not voice.
