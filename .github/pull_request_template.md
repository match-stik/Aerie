## What does this PR do?

<!-- One or two sentences. Link to the issue if there is one. -->

## How to test

<!-- Steps to verify this works. -->

## Checklist

- [ ] `npm run build` passes (both backend and frontend)
- [ ] Tested locally — server starts, WebSocket connects
- [ ] One concern per PR (not bundling unrelated changes)

## Decomposition sequencing (when applicable)

- [ ] If this is WS decomposition work: all agent decomposition extraction PRs are already merged and stable on `main`
- [ ] If this is agent decomposition work: this PR follows strict extraction order and does not stack behind an unmerged first extraction
- [ ] First extraction boundary (SDK stream-event handling from `packages/backend/src/services/agent.ts`) is treated as the base extraction before additional decomposition PRs
- [ ] This extraction preserves behavior parity, includes targeted tests for moved logic, and shows no backend regression in existing build/check flow
