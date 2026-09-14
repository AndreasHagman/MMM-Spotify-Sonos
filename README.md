# MMM-Spotify-Sonos

Search Spotify for tracks and playlists, play them now or add them to
the queue, and pick which Spotify Connect device (e.g. a Sonos speaker
or speaker group) they play on.

## Requirements

- A **Spotify Premium** account (needed for Sonos's own Spotify
  integration and for this module's search/browse calls).
- The machine running MagicMirror must be on the **same local network**
  as your Sonos speakers — this module talks to Sonos directly over
  UPnP (the same approach `MMM-Sonos` uses), not through Spotify's
  cloud, so it needs to reach them on the LAN.

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

## How playback control works

Spotify's public Web API cannot control a Sonos speaker at all — this
was confirmed by testing directly against real hardware: Sonos never
appears in Spotify's device list, and every playback command (play,
pause, skip, queue) returns 403 Forbidden regardless. So this module
doesn't try to route playback through Spotify Connect. Instead, once
you pick (or the module auto-detects) a Sonos zone or group, "Play
now" / "Add to queue" / "Play-pause" / "Skip" all talk to that Sonos
speaker directly over your local network, the same way `MMM-Sonos`
does. Spotify's Web API is only used for logging in and for search.

**"Up next"** shows Sonos's own queue, which only contains what's been
explicitly queued (via this module's "Add to queue", or the Sonos/Spotify
apps) — not a full preview of everything Spotify would play next in a
playlist, the way Spotify's own queue view does.

## Known quirks

- **Search limit:** this module's Spotify app currently has its
  `/v1/search` `limit` parameter capped at 10 by Spotify (values above
  that return a 400 "Invalid limit"), tighter than the 1-50 range
  Spotify's docs describe for apps with extended access. `node_helper.js`
  clamps to 10 regardless of `maxSearchResults`, so this shouldn't
  surface as an error — just a note if you're wondering why results are
  capped lower than you configured.

## Config options

| Option                  | Default                          | Description                                                                                           |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `clientId`              | _(required)_                     | Spotify Developer App Client ID                                                                       |
| `redirectUri`           | `http://127.0.0.1:8888/callback` | Must match the app's registered Redirect URI                                                          |
| `pollInterval`          | `7000`                           | How often (ms) now-playing state and Sonos zones are polled                                           |
| `searchDebounce`        | `450`                            | Live-search debounce (ms)                                                                             |
| `maxSearchResults`      | `10`                             | Max results per section (tracks/playlists) — see "Search limit" above                                 |
| `sonosSpotifyRegion`    | `'2311'` (Europe)                | Spotify region code used when generating Sonos playback metadata — change for non-European households |
| `sonosDiscoveryTimeout` | `5000`                           | Milliseconds to wait when discovering Sonos zones on the network                                      |

## Scope

v1 supports track/playlist search, play now, add to queue, play/pause,
skip next/previous, and device selection. Volume, shuffle, and repeat
are intentionally out of scope for v1 (see the design spec).
