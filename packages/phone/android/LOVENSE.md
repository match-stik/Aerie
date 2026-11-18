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
5. In the phone app, open Integrations, Secrets, and paste your developer token
   (Lovense Developer Dashboard, Developer Token) into "Lovense developer
   token". The phone asks the house for it; it is never inside the app file.

Nothing reaches a toy until you tap "Hand over the remote" on the Toys
page. STOP stops every toy and leaves the remote handed over; Take it back
stops them and closes it.

## Without an Android phone holding the toys (a laptop, a browser)

On any other screen the Toys page reaches the toys through the Lovense
Remote app on your own phone, by Lovense's Standard API by server. No SDK
download is needed for this road; it uses the same developer token.

1. Put your developer token in Secrets, as in step 5 above.
2. In the Lovense Developer Dashboard, set the Callback URL to your house's
   public address followed by `/api/toys/cloud/callback`. That is how the
   Lovense Remote app tells the house which toys it holds.
3. Open the Toys page on the laptop, press **Get link**, and open the link (or
   scan its picture) in Lovense Remote on your phone.
4. Connect your toys in Lovense Remote. They show on the Toys page, and the
   orbs, sliders, patterns and sounds all work from there.
5. **Hand over the remote** lets your companions reach the toys too. It closes
   by itself after two quiet hours, and **Disconnect** makes the old link
   worthless.

Every move goes from the house to Lovense to the Lovense Remote app; the token
stays on the house and never reaches the page.

## The ground rules

Aerie is independent and is not endorsed by or affiliated with Lovense. Its
toy bridge follows these conditions, and every copy keeps them:

- Every house gets its own developer token, and it lives in Secrets on that
  house. It never goes into client code, a commit, a build you share, or a
  public page. That holds for the Lovense app road too: every copy of Aerie
  uses its own token, kept on its own server, and never borrows another
  house's.
- The SDK stays Lovense's: downloaded by each house, dropped in unchanged,
  never committed, never redistributed separately, never modified.
- "Compatible with Lovense devices" is the only way the project names them.
  No Lovense or Lovense product name in the project's name, icon, repository,
  listing or domain, and no Lovense logos or product pictures.
- No toy responds to tips, tokens, payments or votes.
- Your stop never goes through the companions, levels stay 0 to 20,
  one command runs at most three minutes, and the phone shuts the toy off
  when it ends. No setting raises the three minutes. Where each of these
  lives: the stop and the level range are in the app itself
  (LovenseToysPlugin.java; the stop zeroes every toy over Bluetooth with no
  network call). The time limit, the shut-off at the end of a command and the
  Hand over the remote gate run in the app's page, which the house serves,
  and the house refuses any command past three minutes before it reaches the
  phone. On the Lovense app road the companions' commands are checked the
  same way by the house before they go to Lovense, and the Lovense Remote app
  on your phone can always stop the toys with no house involved.
- Porting the toy bridge into another project brings none of Aerie's
  arrangements with Lovense along: that project needs its own Lovense
  developer account, its own agreement, and whatever approval Lovense asks of
  it, before it ships.
