# The Android App

Optional. Aerie is a web app first and everything works in a browser. This page
is for the two things a browser cannot do: **leave the page** (a call dock that
follows you out of Aerie) and **buzz your phone when you're not looking** (push
notifications).

If you skip all of this, nothing breaks. That is deliberate and it is checked in
four separate places — see the end of this page.

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
