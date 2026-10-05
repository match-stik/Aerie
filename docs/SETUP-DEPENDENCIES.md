# What each room needs

Aerie runs with none of this. Every item below unlocks one feature and nothing
else — install what you want to use and skip the rest. Nothing here is required
to start the app, sign in, or talk to a companion.

The database is not on this list on purpose: it builds itself on first boot and
repairs its own older shapes. There is nothing to create by hand.

## On the machine

| Feature | Needs | Debian / Ubuntu |
| --- | --- | --- |
| GIF Lab | `ffmpeg`, `gifsicle` | `apt install ffmpeg gifsicle` |
| GIF Lab text overlay | `fontconfig` (for `fc-list`) | `apt install fontconfig` |
| Cutout — background removal | Python 3.10+ with `onnxruntime`, `numpy`, `pillow`, plus a model file | see below |
| Cutout — still export | the same Python (only `pillow` is used) | see below |
| Companion lanes | whichever CLI you route to (`claude`, `codex`) | vendor's installer |

GIF Lab and Cutout both check for these and say what is missing rather than
failing at the button. If a tab tells you something is not installed, install it
and restart Aerie — the check runs per request, but the app reads it on open.

### Fonts for the text tool

The text tool draws with fonts installed on the **machine running Aerie**, not
the fonts on the device you are holding. A bare server usually has three, all
DejaVu — which is why the picker can look so short. Every font you install
appears in it.

```bash
sudo apt install fonts-liberation2 fonts-dejavu-extra fonts-ubuntu \
  fonts-roboto-unhinted fonts-open-sans fonts-lato fonts-comic-neue \
  fonts-cabin fonts-quicksand fonts-inter fonts-firacode fonts-bebas-neue \
  fonts-jetbrains-mono fonts-montserrat fonts-nunito fonts-noto-color-emoji
```

That takes the list from three families to a little over thirty, including
condensed and display faces that suit stickers, and colour emoji that `drawtext`
can render straight into a frame. `apt search '^fonts-'` lists the rest.

Any font file works, package or not — drop `.ttf` or `.otf` files into
`~/.local/share/fonts/` and run `fc-cache -f`. Aerie reads the list through
`fc-list`, so anything fontconfig can see, the picker can offer.

### What Discord does and does not do for you

Nothing here needs installing — it just decides what you are actually solving
for, and it is easy to spend an evening on the wrong half.

Discord **resizes some uploads itself**: static JPG and PNG, and animated GIF
stickers, are resampled to 320×320 on its end, and emoji upload has its own
crop-and-scale step. So the pixel dimensions are rarely what stops you.

What it will not do is make a file lighter. **The byte ceilings are the wall —
256KB for an emoji, 512KB for a sticker** — and something over them is simply
refused. That is what GIF Lab's optimisation controls are for.

Two consequences worth knowing before you start:

- The preserve-colour path exports at exactly 320×320 with transparent padding.
  It is not there to satisfy a dimension requirement; it is there for when you
  would rather do the resize yourself than let Discord resample flat art.
- **An animated sticker cannot be uploaded from the Discord mobile app.** Use
  the Discord desktop app, or a computer or mobile browser at `discord.com` —
  under your **server settings**. The mobile app does not explain the refusal,
  so a perfectly good sticker reads as a bad export.

### The Archivist's provider

The Archivist runs on whichever provider you pick in Memory → Blocks. The
default is **Haiku on the Claude Code subscription**: no API key, and a small
fast model is the right shape for scribe work.

Worth knowing before you leave it there: that provider reaches Claude through
the **Claude Agent SDK**. Today the SDK draws on the subscription. If that ever
changes and SDK usage bills as extra usage, this default would start costing
per token without the picker looking any different. Every other option in the
list says plainly whether it rides a subscription or a metered key, and you can
change it at any time — nothing here is hard-coded.

### Cutout's Python and model

`rembg` is not used here and cannot be: it pins a `numba` version that refuses
modern Python. `tools/cutout.py` runs the ONNX model directly instead, so the
environment is small.

```bash
python3 -m venv ~/aerie-cutout
~/aerie-cutout/bin/pip install onnxruntime numpy pillow
```

Then fetch one model. They come from the rembg release bucket, and any of these
work — the script picks its normalisation from the model's input size:

- `u2net.onnx` — fast, good on single subjects. Drops the least salient person
  in a group shot.
- `isnet-general-use.onnx` — better on groups; can lose a low-contrast edge.
- `BiRefNet-general-bb_swin_v1_tiny.onnx` — slowest (~4× isnet) and the
  cleanest, including hair against a lit wall and dark fabric on dark wood.

```bash
curl -L -o ~/aerie-cutout/u2net.onnx \
  https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx
```

Point Aerie at both in `aerie.yaml`:

```yaml
integrations:
  cutout:
    python: /home/you/aerie-cutout/bin/python
    model: /home/you/aerie-cutout/u2net.onnx
```

No model is right on every image, which is why the tab has a brush: paint the
mask back where the model got it wrong instead of hunting for a better model.

## Logins and keys

All of these live in **Settings → Keys**, stored in the database rather than in
a file in the repo. What you need depends entirely on which lanes you use.

| Feature | Needs |
| --- | --- |
| Companion replies | an authenticated CLI for the lane you route to, or an API key for a router lane |
| Voice Mode — hearing you | a Groq key (speech to text) |
| Voice Mode — speaking | an ElevenLabs key, plus a voice id per companion |
| Voice Mode — credit meter | the same ElevenLabs key, with the **User > Read** permission enabled |
| Studio — image generation | whatever the chosen backend needs; the Create tab reports this per backend before you spend a prompt |
| Memory → Cortex tab | a deployed Cortex worker URL and its token — see `workers/cortex/README.md`. The URL is entered on the Cortex tab itself, not here |
| Push notifications | web-push keys generated on first use |
| Weather, GIF search | their own free keys, entered where the feature asks |

Blocks and Self-Knowledge need none of this: they live in Aerie's own database.
Only the Cortex tab talks to an outside service.

### The ElevenLabs permission people miss

An ElevenLabs key speaks fine out of the box, but the credit meter reads your
account rather than your voices, and that is a separate permission. In the
ElevenLabs dashboard: **Developers → API → Edit → User → Read**. Without it
speech still works and the meter simply stays blank, which looks like a broken
meter rather than a missing checkbox.

### OpenSubtitles, for the Screening Room

A free account and an API key from opensubtitles.com, dropped into Integrations
→ Secrets. Without it the Screening Room still runs — you can hand it a subtitle
file directly — but it cannot go and fetch one for you.

The free tier's download quota is reported back on every call, so you can see
what is left rather than guessing. Measured rather than taken from the docs: it
answers 100 a day, not the 5 the tier is usually described as.

### Notification access, for the clock that follows you

Android only, and entirely optional. With it granted, Aerie can read what your
player says is playing and anchor the screening clock to a pause by itself.
Without it, nothing breaks and nothing nags — you tell a companion where you are
and they set it.

One honest limit: it only reads while Aerie is the app in front. That is usually
true, because the show tends to float in a small window over it, but an app
Android has put to sleep reports nothing and says so rather than guessing.

## Which of these matter for you

If you only want to talk to a companion: an authenticated CLI, and nothing else
on this page.

If you want images: Studio's Create tab tells you what each backend is missing.

If you want emoji and sticker work: `ffmpeg` and `gifsicle`, then the Python
environment above when you want backgrounds removed.

If you want long-term memory beyond the app's own database: the Cortex worker.
