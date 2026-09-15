# MMM-Spotify-Sonos

Search Spotify for tracks and playlists, play them now or add them to
the queue, and choose which Sonos speaker or speaker group they play on
— controlled directly over your local network, not through Spotify
Connect (see "How playback control works" below).

## Screenshots

<!-- Paste a screenshot below each heading — drag & drop an image into
     this file on github.com's editor and it'll insert the markdown for
     you, or upload it under docs/screenshots/ and reference it with a
     relative path. Remove any heading you don't have a screenshot for. -->

### Closed (idle / now playing)

<!-- e.g. ![Idle widget on the mirror](docs/screenshots/closed-idle.png) -->

### Open (overlay)

<!-- e.g. ![Overlay open](docs/screenshots/overlay-open.png) -->

### Search

<!-- e.g. ![Search results](docs/screenshots/search.png) -->

### Up next / queue

<!-- e.g. ![Up next queue](docs/screenshots/queue.png) -->

## Disclaimer & intended use

**Intended use:** this module is a touchscreen control panel for playing
or queuing Spotify tracks/playlists on Sonos speakers already set up on
your home network — nothing more. It's not a general Spotify remote and
not a full Sonos control panel (no volume, shuffle, repeat, or
non-Spotify sources — see "Scope" below).

**Spotify's Web API is used only for logging in, searching, and reading
your own playlists.** It is deliberately **not** used to control
playback: Spotify's public Web API cannot control a Sonos speaker at
all (confirmed by testing against real hardware — Sonos never appears
in Spotify's device list, and every playback command returns 403
Forbidden, regardless). So instead, all actual playback — play now,
queue, play/pause, skip — talks directly to your Sonos speakers over
the local network via the `sonos` npm library — the same approach used
by [MMM-Sonos](https://github.com/AndreasHagman/MMM-Sonos), the sibling
module this one was designed to sit alongside for Sonos status/control
— bypassing Spotify Connect entirely. See "How playback control works"
below for the full explanation.

## Requirements

- A **Spotify Premium** account — required by Sonos's own Spotify
  integration, i.e. for anything to actually play on a speaker. Logging
  in and searching work on a free account; only playback needs Premium.
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

4. Install this module's dependencies (it needs the `sonos` package;
   without it `node_helper.js` fails at startup with
   `Cannot find module 'sonos'`):

   ```text
   cd modules/MMM-Spotify-Sonos && npm install
   ```

5. Start MagicMirror, tap the Spotify icon, and log in. Tokens are
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

Note: the collapsed "now playing" display always shows whichever zone
the module detects playing Spotify content, which may differ from the
zone you've explicitly selected for new commands if more than one zone
is in use at once.

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

## On-screen keyboard (touchscreen kiosks)

This module is built for a touchscreen with no physical keyboard, but
Electron doesn't invoke any OS on-screen keyboard on input focus, on any
platform — tapping the search box won't pop one up by itself. Rather than
build a keyboard into the module, it shells out to whatever virtual
keyboard binary you configure via `virtualKeyboardCommand`, starting it
when the search box is focused and closing it on blur (or when the
overlay closes). Leave it unset (the default) and this is a no-op.

On a Raspberry Pi kiosk, [matchbox-keyboard](https://github.com/matchbox-project/matchbox-keyboard)
is a common choice:

```bash
sudo apt install matchbox-keyboard
```

```js
{
  module: "MMM-Spotify-Sonos",
  config: {
    // ...
    virtualKeyboardCommand: "matchbox-keyboard"
  }
}
```

`virtualKeyboardCommand` also accepts a `[command, ...args]` array for a
keyboard that needs flags, e.g. `["wvkbd-mobintl", "-l", "landscape"]`.

Note: matchbox-keyboard is an X11 app. On a Wayland-based Pi desktop
(labwc, wayfire, etc.) it should still run via XWayland, but this hasn't
been verified on real hardware yet — a Wayland-native keyboard (e.g.
`wvkbd`, `squeekboard`) may be a better fit there.

## Config options

| Option                   | Default                          | Description                                                                                           |
| ------------------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `clientId`               | _(required)_                     | Spotify Developer App Client ID                                                                       |
| `redirectUri`            | `http://127.0.0.1:8888/callback` | Must match the app's registered Redirect URI                                                          |
| `pollInterval`           | `7000`                           | How often (ms) now-playing state and Sonos zones are polled                                           |
| `searchDebounce`         | `450`                            | Live-search debounce (ms)                                                                             |
| `maxSearchResults`       | `10`                             | Max results per section (tracks/playlists) — see "Search limit" above                                 |
| `sonosSpotifyRegion`     | `'2311'` (Europe)                | Spotify region code used when generating Sonos playback metadata — change for non-European households |
| `sonosDiscoveryTimeout`  | `5000`                           | Milliseconds to wait when discovering Sonos zones on the network                                      |
| `virtualKeyboardCommand` | `null`                           | Command (string or `[command, ...args]`) to show an on-screen keyboard — see above. Off by default    |

## Scope

v1 supports track/playlist search, play now, add to queue, play/pause,
skip next/previous, and device selection. Volume, shuffle, and repeat
are intentionally out of scope for v1 (see the design spec).

## License

[MIT](LICENSE) © Andreas Hagman
