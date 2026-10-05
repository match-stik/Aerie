# Contributing to Aerie

Thanks for wanting to help. Aerie has been in daily use since March 2026, and most of it was shaped by living in it rather than planning it — so some of the choices below will look strange until you know what they're working around. Where that's true, this guide says so.

## How to reach us

- **Bug reports** — [GitHub Issues](https://github.com/match-stik/Aerie/issues)
- **Feature proposals** — [GitHub Issues](https://github.com/match-stik/Aerie/issues) (open an issue before writing code)
- **Questions & discussion** — [GitHub Discussions](https://github.com/match-stik/Aerie/discussions)

## Send these straight in

No need to ask first:

- **Bug fixes** — say what was broken and how you fixed it
- **Documentation** — typos, clarifications, better examples, translations
- **Accessibility** — contrast, ARIA, keyboard navigation, screen reader support
- **Themes** — the phone's palette lives in Settings → Appearance rather than in files, so improvements to the picker or the custom-color editor are welcome
- **Platform fixes** — Windows/macOS/Linux edge cases, path handling, PM2 configs
- **Tests** — there are some, and plenty of surface without any

## Ask first

Open an issue before writing code for these, so nobody spends a weekend on something that won't land:

- **New features** — describe what you want to do with it, not just how you'd build it
- **New integrations** — extra communication channels, notification systems
- **Hook system changes** — the context injection pipeline holds a lot up
- **Orchestrator changes** — scheduling, triggers, failsafe behavior
- **Database schema changes** — migrations land on people who already have data
- **New dependencies** — the tree is small on purpose and we'd like to keep it that way

## Things that aren't going to change

Not because they're settled forever — because changing them would take the house apart:

- **New runtimes.** There are three: the interactive Claude Code CLI lane, the Codex runtime, and a multi-provider API router. Another model provider belongs inside the router rather than in a fourth runtime.
- **The frameworks.** React on the front, Express behind it.
- **Self-hosting.** Aerie runs on your own box, and a hosted version would mean holding other people's conversations.
- **Desktop wrappers.** The phone is a PWA and the Android build is a thin Capacitor shell around it. That's as far as native goes.

## Development setup

```bash
git clone https://github.com/match-stik/Aerie.git
cd Aerie
npm install
node scripts/setup.mjs
npm run build
```

With hot reload:

```bash
npm run dev          # Backend (tsx watch)
npm run dev:phone    # Phone UI (Vite dev server with proxy)
npm run dev:all      # Both at once
```

## Sending a PR

- **One thing at a time.** Separate changes are much easier to review, and much easier to revert.
- **Say what and why.** The why is the part we can't reconstruct later.
- **Drive it once.** Start the server, send a message, check the WebSocket connects and settings load.
- **Run the tests.** They use the built-in Node runner, so there's nothing to install:

  ```bash
  npx tsx --test $(find packages -name '*.test.ts' -not -path '*/node_modules/*')
  ```

- **Build before you send.** `npm run build` covers backend (`tsc`) and phone (`vite build`); `npm run check` type-checks every workspace without emitting.
- **Follow the code around you.** If something looks oddly specific, it's usually load-bearing — ask rather than tidying it away.
- **Read what you generated.** If an AI wrote it, go through it properly first.

### Taking a large module apart

One seam at a time, never in parallel:

- Keep one extraction open at a time and merge it before starting the next.
- An extraction is done when it behaves the same as what it replaced, has tests for the logic it moved, and leaves the build and check flow green.
- Only stack a follow-up once the base one is merged and stable on `main`.
- Backend agent decomposition comes before WebSocket decomposition; don't start the WS work until the agent set is complete.

## Code style

- TypeScript strict mode
- Semicolons throughout, frontend and backend
- Theme colors come from CSS variables (`var(--token)`) and the shared palette, not hardcoded hex
- Functions over classes where it's a choice
- Descriptive names rather than comments explaining short ones

## License

Aerie is Apache 2.0. By contributing you agree your contributions are licensed the same way — see [LICENSE](LICENSE), and [NOTICE](NOTICE) for the projects Aerie is built on and what came from each.
