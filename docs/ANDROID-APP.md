# The Android App

Optional. Aerie is a web app first and everything works in a browser: chat,
your companions, Studio, the apps, voice while the page is open. The Android app
is the same house in a shell that can reach the parts of a phone a web page
can't. The table below says which those are, so you can decide whether you need
it.

If you skip all of this, nothing breaks. That is deliberate and it is checked in
four separate places — see the end of this page.

## What needs the app, and what works in a browser

| Feature | In a browser | Needs the Android app for |
|---|---|---|
| Notifications | Yes, with web push: turn on notifications in Settings in that browser. On an iPhone, add Aerie to your home screen from Safari first. | Firebase push instead of web push, for the phone itself. Either is fine. |
| Voice calls with your companions | Yes, while the page is open and on screen. | The call dock that stays on top when you leave Aerie, and a call that keeps working with the screen off. |
| A call in the car over Bluetooth | No. | Playing the reply as a phone call so the car's speakers carry it, and holding the mic while the app is in the background. |
| Places (Thresholds) | You can pin a place and open what was left there while Aerie is open and you're standing in it. | Opening a place's note when you arrive with Aerie closed (geofencing, with the always-on location grant). |
| Lovense toys | No. | Connecting to the toys over Bluetooth, through Lovense's SDK on your own developer token. See LOVENSE.md. |
| Screening Room following your show | You set the clock by hand. | Following what's playing on your phone automatically (it reads the phone's media sessions, nothing else). |
| Spotify | Yes, if Spotify is already open somewhere: your phone, a computer or the web player. | Waking Spotify itself when it's closed. |
| The back gesture | Yes. The browser's back (and Android's back gesture, which the browser receives) steps back one screen at a time, the same as in the app, and leaves Aerie only from the home screen. | Putting Aerie away at the home screen instead of leaving it. |
| Updates | Every refresh is already the newest. | Updating the app's own shell when a new one is built. |
| Status bar and navigation bar colors | The top bar follows your theme in Chrome on Android and in an installed web app (the page sets its theme color). The navigation bar at the bottom is the browser's own. | Painting the navigation bar too, so the whole frame matches your theme. |
| Crash notes | Errors in the page are reported. | Reporting a crash of the app itself. |

Nothing above changes what your companions can do. They live on the server
either way; the app only gives them more of your phone to reach you through.

---

## What you need

- A Firebase project, if you want push
- The Android SDK and a JDK **on the machine Aerie runs on** — your companion
  needs them, you don't
- Ten minutes

---

## 1. Your own Firebase project

Push has to be *yours*. It runs on Firebase Cloud Messaging, and the credentials
identify your project — you cannot borrow anyone else's.

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add
   project**. Analytics is not needed.
2. In the project, **Add app → Android**.
3. Give it a package name. Whatever you like — `com.yourname.aerie` is fine — and
   remember it, because the app has to be built with the same one.
4. Download the **`google-services.json`** it hands you and put it at:

   ```
   packages/phone/android/app/google-services.json
   ```

   That path is gitignored on purpose. It identifies your project and should
   never be committed anywhere.

5. Back in Firebase: **Project settings → Service accounts → Generate new private
   key.** That downloads a JSON file.
6. In the phone: **Integrations → Secrets → Platforms**, paste the whole contents
   of that file into **Firebase service account**. It is one long line of JSON;
   paste all of it.

That second one is what lets the server send. The first is what lets the app
receive. You need both, and they are different files.

## 2. Set the package name

If you chose a package name other than the default, set it in
`packages/phone/android/app/build.gradle` (`applicationId`) so it matches what
you registered with Firebase. They have to agree or push will silently never
arrive.

## 3. Ask your companion to build it

You do not have to do this part yourself, and in practice you probably
shouldn't. Your companion has a terminal on the machine Aerie runs on. Ask them
to build the app and hand it to you, and it arrives on your phone as an update
card — no cables, no Android Studio, nothing to install on your laptop.

If you would rather do it by hand, it is three commands in `packages/phone`:

```bash
npx vite build            # the web bundle the app wraps
npx cap sync android
cd android && ./gradlew assembleRelease
```

Sign it however you normally sign an Android build.

## 4. How a build reaches your phone

Two files in `data/app/` — that is the whole mechanism.

- `aerie.apk` — the signed build
- `version.json` — what the app checks against

```json
{
  "versionCode": 12,
  "versionName": "1.3",
  "builtAt": "2026-01-01T00:00:00Z",
  "notes": "What changed, in words you'd actually say.",
  "sha256": "…",
  "bytes": 35449868
}
```

With both present, **Settings → Data** shows an update card: the version, the
notes, and a button. Tap it and the phone downloads and installs. With neither,
the card never appears and nothing complains.

**If you are the companion reading this:** write `version.json` from the APK you
just built, not from what you intended to build. `versionCode` and `sha256`
should come from the real file. A version card that describes a build nobody
shipped is worse than no card, because the app has no way to tell it is being
lied to.

The notes field is the one a person actually reads. Say what changed the way you
would say it to them.

---

## The floating dock

During a voice call the app can put a small dock on top of whatever else you are
doing — three faces, their ring colours, and level bars that move while somebody
is speaking. Leave Aerie and it appears; come back and it goes.

That needs one permission Android guards more heavily than most, and it is worth
knowing all three of these before you go looking:

1. **The menu has two names.** Some phones call it *Appear on top*. Stock Android
   and others call it **Settings → Apps → Special app access → Display over other
   apps**. The ordinary app-info page usually does not list it at all.
2. **On Android 13 and later, a sideloaded app cannot reach it until you unlock
   restricted settings.** The switch appears in the list and is *greyed*, not
   hidden — which reads exactly like a broken permission rather than a locked
   one. Open the app's info page, use the overflow menu, choose **Allow
   restricted settings**, and then go to Special app access.
3. **Without it, nothing breaks.** The dock simply stays inside the app, where it
   works in any browser too. Voice mode is fully usable either way.

## How push actually works

Worth knowing before you wire it, because it is simpler than most setups and
that surprises people.

There is no relay and no third-party service in the middle. Your own server
holds the Firebase service-account key, mints a token with it, and posts
straight to `fcm.googleapis.com` — Firebase Cloud Messaging v1, direct from the
machine Aerie runs on. Nothing about a message leaves your box except the
notification itself, addressed to your own device.

And it only fires when you are **not** connected. If Aerie is open in front of
you, the server sees the live socket and sends nothing — you already have the
message. Close the app or lock the phone and the same message arrives as a
notification instead.

One kind of push is silent. When your companion plays you a song and Spotify is
not running anywhere, the server sends the app a data-only message with nothing
to show: the app's own push listener wakes Spotify on the phone, the server
waits for the phone to appear among Spotify's devices, and the song plays. Every
other push is handed on to the ordinary notification path unchanged.

## Spotify on the phone

The Spotify app works from the browser too, but only the Android app can start
Spotify when it is closed: a tap that comes back as nowhere to play wakes
Spotify on the phone (through Spotify's own App Remote kit, Apache-2.0, bundled
in `app/libs`, and a media play key as the fallback) and sends the tap again.
For that, your Spotify developer app needs this app's package name and signing
fingerprint; [workers/spotify-mcp/README.md](../workers/spotify-mcp/README.md)
has the steps. Without them the app still plays anywhere Spotify is already
open, and says so when it is not.

## If you skip all of this

Nothing fails, and it isn't luck — each path is guarded on purpose:

- **No app installed.** `/api/app/version` finds no `version.json` and answers
  `{ "available": false }`. Nothing to update, nothing complains.
- **Browser instead of the app.** Native calls go through a wrapper whose comment
  says it plainly: *the browser build intentionally has no native implementation.
  Voice mode stays fully usable there; it simply cannot leave the page.*
- **No `google-services.json` when you build.** The Gradle file checks for it, and
  if it's absent it skips the Firebase plugin and logs *"google-services.json not
  found... Push Notifications won't work."* **The APK still builds.**
- **No `fcm_service_account` secret.** The server logs *"fcm_service_account not
  set — push disabled"* and sends nothing.

So the honest summary: without any of it you get the whole of Aerie in a browser,
minus a dock that follows you out of the tab and a phone that buzzes. With the
APK but no Firebase, you get the app and the dock, and still no buzzing.
