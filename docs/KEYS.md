# Every key Aerie can use

You don't need any of these to talk to your companion. Claude Code and Codex sign in with their own logins, not keys. Each key below switches on one thing, and the app tells you when something you're trying to use is missing its key.

Keys are kept in the app's own secrets store, never in a file in the repo. Most go in **Integrations → Secrets**; the rest go on the page where the thing they switch on lives, and that's said beside each one. Every key can also be set as an environment variable instead (the name in brackets), which is handy on a server.

## Voice

**ElevenLabs API key** (`ELEVENLABS_API_KEY`). Lets your companion speak out loud, in replies and voice notes. Get it at elevenlabs.io → Settings → API keys. Goes in Integrations → Secrets.

**ElevenLabs voice ID** (`ELEVENLABS_VOICE_ID`). Which ElevenLabs voice is used. Each companion can have their own on their card in the Companions app; this one is the fallback when a companion has none.

**Groq API key** (`GROQ_API_KEY`). Turns your voice into text when you talk instead of type. Get it at console.groq.com. Goes in Integrations → Secrets. If you run a speech-to-text server of your own, Aerie tries that first (the `voice.local_stt_url` setting).

## Where you talk

**Discord bot token** (`DISCORD_BOT_TOKEN`). Brings your companion into Discord. Make a bot at discord.com/developers/applications, then paste the token on the Discord tab in Integrations. [DISCORD-BOT.md](DISCORD-BOT.md) walks through the bot side.

**Telegram bot token** (`TELEGRAM_BOT_TOKEN`). Brings your companion into Telegram. Talk to @BotFather on Telegram to make a bot. Goes in Integrations → Secrets.

**Firebase service account** (`FCM_SERVICE_ACCOUNT`). Push notifications to the Android app. In Firebase: Project settings → Service accounts → Generate new private key, and paste the whole file. Goes in Integrations → Secrets. Only needed for the Android app; [ANDROID-APP.md](ANDROID-APP.md) has the rest.

Notifications in a desktop browser need no key: the house makes its own pair the first time a browser asks.

## Other models

These are only for running a companion on an API provider instead of Claude Code or Codex. Each goes on **Integrations → Providers**, next to the provider it belongs to.

**OpenRouter** (`OPENROUTER_API_KEY`), from openrouter.ai. **OpenAI** (`OPENAI_API_KEY`), from platform.openai.com. **xAI** for Grok (`XAI_API_KEY`), from x.ai. **Hugging Face** (`HUGGINGFACE_API_KEY`), from huggingface.co/settings/tokens. **Ollama Cloud** (`OLLAMA_API_KEY`), from ollama.com/settings/keys. Ollama running on your own machine needs no key.

## Extras

**Cortex worker address and token** (`CORTEX_WORKER_URL`, `CORTEX_AUTH_TOKEN`). The optional searchable memory store. Deploy [workers/cortex](../workers/cortex/README.md) and paste its address and the token you gave it on **Memory → Cortex**.

**Spotify.** Spotify takes a worker you deploy and a Spotify developer app of your own rather than a single key; [workers/spotify-mcp/README.md](../workers/spotify-mcp/README.md) walks through it.

**OpenSubtitles API key** (`OPENSUBTITLES_API_KEY`). Lets the Screening Room fetch subtitles for a show you're watching together. Get it at opensubtitles.com → your account → API consumers; the free tier is enough. Goes in Integrations → Secrets.

**Giphy API key** (`GIPHY_API_KEY`). GIF search in the chat. Get it at developers.giphy.com. Goes in Integrations → Secrets.

**GitHub token** (`GITHUB_TOKEN`). Lets the house read your own repository's security alerts. A fine-grained, read-only token with Contents, Metadata and Dependabot alerts is enough. Goes in Integrations → Secrets.

**Lovense developer token.** Only for the toys in the Android app, and always your own. Get it from Lovense's developer dashboard and read the Toys section of the [README](../README.md#toys-optional) and [LOVENSE.md](../packages/phone/android/LOVENSE.md) first. Goes in Integrations → Secrets.

## Picture-making

Studio draws through whichever painter you pick, and each one says on the Create tab what it needs. Codex draws on your ChatGPT sign-in with no key.
