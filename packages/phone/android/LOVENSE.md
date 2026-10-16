# Lovense toys (optional)

The phone app can talk to Lovense toys over Bluetooth itself, through
Lovense's Android SDK, with no Lovense Remote in between. The SDK is
Lovense's software, so it does not ship with this kit: each house downloads
its own copy. Without it the app still builds, and the Toys page says the app
has no toy bridge.

1. Make a Lovense developer account at
   https://www.lovense.com/sextoys/developer/join/ and read Lovense's terms
   for their SDK there.
2. Download the Android SDK (1.6.0 is the version this bridge was built
   against) from https://developer.lovense.com/docs/native-sdks/android-native-sdk.html.
3. Take `lovense.aar` out of the zip and put it in `app/libs/` as
   `lovense-1.6.0.aar`. Any `lovense-*.aar` there is picked up, and git
   ignores it, so it never gets committed.
4. Build the APK as usual. The toy bridge is compiled in only when that file
   is present.
5. In the phone app, open Settings, Secrets, and paste your developer token
   (Lovense Developer Dashboard, Developer Token) into "Lovense developer
   token". The phone asks the house for it; it is never inside the app file.

Nothing reaches a toy until the owner taps "Hand over the remote" on the Toys
page, and any stop takes it back.

## The ground rules

Aerie is independent and is not endorsed by or affiliated with Lovense. Its
toy bridge follows these conditions, and every copy keeps them:

- Every house gets its own developer token, and it lives in Secrets on that
  house. It never goes into client code, a commit, a build you share, or a
  public page.
- The SDK stays Lovense's: downloaded by each house, dropped in unchanged,
  never committed, never redistributed separately, never modified.
- "Compatible with Lovense devices" is the only way the project names them.
  No Lovense or Lovense product name in the project's name, icon, repository,
  listing or domain, and no Lovense logos or product pictures.
- No toy responds to tips, tokens, payments or votes.
- The owner's stop never goes through the companions, levels stay 0 to 20,
  one command runs at most three minutes, and the phone shuts the toy off
  when it ends.
- Porting the toy bridge into another project brings none of Aerie's
  arrangements with Lovense along: that project needs its own Lovense
  developer account, its own agreement, and whatever approval Lovense asks of
  it, before it ships.
