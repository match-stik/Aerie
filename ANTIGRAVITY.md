# Antigravity CLI (agy)

Google's agent-first coding CLI tool. Free image generation on Pro tier.

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

### Image Generation
```bash
agy /image "a fox asleep in a teacup"
```

### Check Quotas
```bash
agy /usage
```

## Models

Default models (as of v1.0.13):
- **Text**: gemini-3.5-flash
- **Image**: gemini-3.1-flash-image-preview

Image gen models available: Flash 3.5 Low/Medium/High, Pro 3.1 Low/High

## Quotas (Pro Tier)

Per 5-hour rolling window:
- Claude/GPT models: separate pool
- Gemini models: separate pool
- Image generation: 2/minute, higher daily cap than free

Free tier: ~2 images/minute, very low daily cap, data may be analyzed by Google.

## Aerie Integration

Studio has "Gemini (Free)" backend option that uses agy for image generation:
- `packages/backend/src/services/runtimes/antigravity.ts`
- Prompts piped via stdin (not CLI args) to handle large payloads
- Images saved to `data/generated-images/` and served via `/api/studio/gallery/`

## SDK (Not Recommended)

A Python SDK exists (`pip install google-antigravity`) but:
- Requires API key (can't use Pro OAuth)
- Free API key has severe limits
- Audio/video input may not work on free tier
- Spawns localharness subprocess that can lag system

Stick with CLI for actual use.
