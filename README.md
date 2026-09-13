# MMM-Spotify-Sonos

Search Spotify for tracks and playlists, play them now or add them to
the queue, and pick which Spotify Connect device (e.g. a Sonos speaker
or speaker group) they play on.

## Setup

1. Create a Spotify Developer app at
   https://developer.spotify.com/dashboard — note its **Client ID**
   (no secret needed, this module uses PKCE).
2. In the app's settings, add a Redirect URI matching your `redirectUri`
   config (default `http://localhost:8888/callback`).
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

## Config options

| Option             | Default                          | Description                                  |
| ------------------ | -------------------------------- | -------------------------------------------- |
| `clientId`         | _(required)_                     | Spotify Developer App Client ID              |
| `redirectUri`      | `http://localhost:8888/callback` | Must match the app's registered Redirect URI |
| `pollInterval`     | `7000`                           | How often (ms) now-playing state is polled   |
| `searchDebounce`   | `450`                            | Live-search debounce (ms)                    |
| `maxSearchResults` | `12`                             | Max results per section (tracks/playlists)   |

## Scope

v1 supports track/playlist search, play now, add to queue, play/pause,
skip next/previous, and device selection. Volume, shuffle, and repeat
are intentionally out of scope for v1 (see the design spec).
