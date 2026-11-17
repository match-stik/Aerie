<!-- Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before. -->
# Aerie on a laptop

The house in its own window on Windows (or a Mac, or Linux), plus the one thing a browser can't do: start Spotify on that computer when one of you presses play and Spotify isn't running there.

## Build it

```
cd desktop
npm install
npm run build:win
```

That leaves `dist/Aerie-<version>-win.zip`. Unzip it anywhere and run `Aerie.exe`; nothing gets installed.

## Which house

On first run the app asks for your house's address (the one you open in a browser). To build a copy that already knows, put `house.json` beside `main.cjs` before building:

```
{ "url": "https://your-house.example" }
```

`house.json` is ignored by git on purpose.

## Spotify

When a press finds nowhere to play, the page asks the app to start Spotify here (minimized where it can), waits for this computer to show up among your Spotify devices, and presses play again. A companion can do the same from the house: `POST /api/internal/spotify/wake-play` wakes the laptop when you're on its app, otherwise your phone; `"where": "laptop"` or `"phone"` picks one.

The house tells the app apart from a browser by `AerieDesktop/<version>` at the end of its user agent.

## Updating from inside the app (Windows)

Raise `version` in `package.json`, build, then run `npm run stage` from this folder: it copies the zip into the house's `data/app/desktop` with a `version.json` beside it. The app's Settings > Laptop then offers Check and Update.

Update downloads the zip with your sign-in into the app's own settings folder (`%APPDATA%\Aerie\update`), unpacks it with the `tar.exe` Windows ships, and starts the new copy before closing. The new copy waits for the old one to close, copies itself over the app's folder (retrying while Windows still holds files), and opens the app again whatever happened, so a failed update still leaves you the old one. There is no script in between.

Every step goes into `update.log` in `%APPDATA%\Aerie` before anything closes. The next start shows how it went in Settings > Laptop and sends the whole log to the house's error log as a `laptop-update-log` line.

The updater that runs is the copy already installed, so a copy from before 1.1.6 needs one update by hand: quit from the tray icon (closing the window only tucks it away), open `<your house>/api/app/desktop/download` in a browser where you're signed in, and unzip it over the app's folder.
