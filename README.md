# MMM-Spotify-Sonos

Search Spotify for tracks and playlists, play them now or add them to
the queue, and pick which Spotify Connect device (e.g. a Sonos speaker
or speaker group) they play on.

## Requirements

A **Spotify Premium** account is required. Spotify Connect device
transfer and the Web API's playback-control endpoints (play, pause,
skip, add-to-queue) are Premium-only, so this module will not work on a
free account.

## Setup

1. Create a Spotify Developer app at
   https://developer.spotify.com/dashboard — note its **Client ID**
   (no secret needed, this module uses PKCE).
2. In the app's settings, add a Redirect URI matching your `redirectUri`
   config (default `http://127.0.0.1:8888/callback`). Spotify requires
   HTTPS redirect URIs except for the loopback IP literal `127.0.0.1` —
   the hostname `localhost` is rejected even though it's the same
   machine, so use the IP literal, not the name.
3. Add the module to `config.js`:

   ```text
   {
     module: 'MMM-Spotify-Sonos',
     position: 'bottom_right',
     config: {
       clientId: 'YOUR_SPOTIFY_CLIENT_ID'
     }
   }
   ```

4. Start MagicMirror, tap the Spotify icon, and log in. Tokens are
   stored in `spotify_access_token.json` next to `node_helper.js`
   (gitignored) and refreshed automatically.

`clientId` must be set in `config.js` before the "Log in with Spotify"
button will do anything — without it the login attempt reports a
"Missing clientId in config" error instead of opening Spotify.

To switch accounts, use the **Log out** button in the overlay header:
it deletes the stored token file and returns the module to the "Log in
with Spotify" state, ready for a different account.

## Known quirks

- **No devices showing up?** Spotify Connect only lists a device once
  it's been recently active. If the device picker says "No Spotify
  Connect devices found," open the Spotify app on your phone (or start
  playing something via Spotify Connect to a Sonos speaker from there)
  at least once — it should then appear here too. This isn't something
  this module can fix; it's how Spotify Connect discovery works.
- **Search limit:** this module's Spotify app currently has its
  `/v1/search` `limit` parameter capped at 10 by Spotify (values above
  that return a 400 "Invalid limit"), tighter than the 1-50 range
  Spotify's docs describe for apps with extended access. `node_helper.js`
  clamps to 10 regardless of `maxSearchResults`, so this shouldn't
  surface as an error — just a note if you're wondering why results are
  capped lower than you configured.

## Config options

| Option             | Default                          | Description                                  |
| ------------------ | -------------------------------- | -------------------------------------------- |
| `clientId`         | _(required)_                     | Spotify Developer App Client ID              |
| `redirectUri`      | `http://127.0.0.1:8888/callback` | Must match the app's registered Redirect URI |
| `pollInterval`     | `7000`                           | How often (ms) now-playing state is polled   |
| `searchDebounce`   | `450`                            | Live-search debounce (ms)                    |
| `maxSearchResults` | `10`                             | Max results per section (tracks/playlists) — see "Search limit" above |

## Scope

v1 supports track/playlist search, play now, add to queue, play/pause,
skip next/previous, and device selection. Volume, shuffle, and repeat
are intentionally out of scope for v1 (see the design spec).
