# Antigravity CLI (agy)

Google's command-line agent. Aerie uses it for pictures: it can paint on a Google account's own allowance, with no API key.

**Use a separate Google account, never your main one.** Google has locked accounts for using agy through third-party apps (a TOS violation lock; a first strike can sometimes be appealed, a second is permanent). Keep the account you sign agy in with apart from your mail, Drive, photos and billing, so a lock costs you nothing that matters.

## Install

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

Installs to `~/.local/bin/agy`. Add to PATH if needed:
```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Authentication

After install, run any command to trigger OAuth:

```bash
agy "hello"
```

This opens a browser for Google OAuth. Sign in with a Google account that has Gemini Pro subscription for best quotas.

### Multiple Accounts

You can auth additional accounts:
```bash
agy /logout
agy "hello"  # triggers new OAuth flow
```

Tokens stored in `~/.gemini/antigravity-cli/`.

## Usage

### Interactive Chat
```bash
agy
```

### Check Quotas
```bash
agy /usage
```

## Models

`agy models` lists what your account can use right now. Read on version 1.5.10 in November 2026, the picture models were Gemini 3.8 Flash (High, Medium and Low); it also lists Claude and GPT-OSS models, which Studio doesn't use. Google retires models without much notice, so trust `agy models` over this page.

Studio's list of Gemini models is typed by hand in `packages/backend/src/services/image-gen/settings.ts`, so if Google moves on before Aerie does, that list is the one to update.

## Quotas

`agy /usage` shows what's left. Aerie reads the same thing for the usage meter in the app, and it doesn't use up a turn.

## Aerie Integration

Studio's **Gemini** painter uses agy, as a choice of its own or as a fallback when another painter turns a picture down:
- `packages/backend/src/services/image-gen/antigravity.ts`
- Prompts piped via stdin (not CLI args) to handle large payloads
- Images saved to `data/generated-images/` and served via `/api/studio/gallery/`

## SDK (Not Recommended)

There is a Python SDK, but it wants an API key rather than your Google sign-in. Stick with the CLI.
