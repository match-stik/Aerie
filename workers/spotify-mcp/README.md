# Spotify MCP worker

The MCP server the house and the lanes use to read and drive Spotify:
now playing, play, pause, skip, queue, search, recent, top tracks and
artists, recommendations, playlists read and written.

Base code built by Kay (https://github.com/kaydartistry-maker/Spotify-MCP)
and modified to be used in the app.

index.js is the whole worker, one file (the version in `initialize` says
which one is running; this worker has no BUILD marker).

## Setting it up

1. In Spotify's developer dashboard (developer.spotify.com/dashboard), create
   an app. Its redirect URI is your worker's address plus `/callback`, for
   example `https://spotify-mcp.<your-subdomain>.workers.dev/callback`.
2. Deploy this folder as a Cloudflare worker (the steps are at the top of
   `wrangler.toml`, or paste `index.js` into the dashboard), with a KV namespace
   bound as `SPOTIFY_KV` and three secrets: `SPOTIFY_CLIENT_ID` and
   `SPOTIFY_CLIENT_SECRET` from the dashboard, and `SPOTIFY_REDIRECT_URI`, the
   same redirect as step 1.
3. Open `/auth` on the worker once and say yes. The sign-in is kept in the
   worker's KV, so if it ever lapses, opening `/auth` again is the whole fix.
4. In Aerie, add the worker's `/mcp` address under Integrations > MCP. Any name
   with "spotify" in it (or in the address) is how the Spotify app finds it.

To let the Android app wake Spotify on the phone when it is closed, add your
app to the same Spotify app's settings as an Android package: its package name
(the `applicationId` in `packages/phone/android/app/build.gradle`) and the SHA1
fingerprint of the key your APK is signed with. The phone reads the client id
and redirect off the worker's `/auth` page, so there is nothing else to set.
Spotify has to be installed and signed in on the phone, and the first wake may
show Spotify's own consent screen.

What changed from the base code:

- Playlist rows are read from `item`, falling back to `track`, and the count
  from `items.total`: the same Spotify change reached the shape of the rows
  as well as the endpoint. Artist names and lists are read null-safe. Do not
  revert any of it.
- `spotify_play` with no device named, on NO_ACTIVE_DEVICE, lists
  `/me/player/devices`, picks the active one, else a phone, else the first,
  and asks once more. A named device is never swapped. (Oct 20 2026)
- A player command whose 2xx answer is not JSON counts as done; a read still
  has to be JSON. (Oct 20 2026)
- `spotify_play` takes `context_uri` and `offset_uri` (start a playlist or
  album at one of its songs); recent rows carry `album_uri`. (Oct 20 2026)
- A JSON-RPC notification gets 202 with an empty body instead of an error
  object with no id, which Codex's MCP client quit on. (Oct 23 2026)

- v1.1.0 (Oct 23 2026): hearting songs (`spotify_save`, `spotify_unsave`,
  `spotify_is_saved`, through Spotify's Feb 2026 `/me/library`) and Liked
  Songs (`spotify_saved_tracks`); shuffle, repeat, volume, seek; devices and
  transfer; `spotify_player_state`; moving songs within a playlist; a
  playlist picture. Playlists say `mine`. Search asks for ten at most, the
  Feb 2026 cap. `spotify_get_recommendations` is gone: Spotify answers 404.
- A sign-in through `/auth` is kept in KV and used from then on, so signing
  in again is open `/auth`, say yes, close the page; the
  `SPOTIFY_REFRESH_TOKEN` secret is only the fallback.

`test.mjs` runs every new tool against a pretend Spotify.

Bindings: KV `SPOTIFY_KV`; secrets `SPOTIFY_CLIENT_ID`,
`SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`, `SPOTIFY_REFRESH_TOKEN`.
When the sign-in lapses, open `/auth` on the worker, say yes, and put the
token it shows into the worker's `SPOTIFY_REFRESH_TOKEN` on Cloudflare.

Deploying: read the live code and settings first and keep a copy, upload
with `keep_bindings: ["secret_text"]`, bump the version in `initialize`,
then read back the settings, the live code and the front door.
