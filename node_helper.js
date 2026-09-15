"use strict";

const NodeHelper = require("node_helper");
const Log = require("logger");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { isTokenExpired, readTokenFile, writeTokenFile, deleteTokenFile, refreshAccessToken, generateCodeVerifier, generateCodeChallenge, generateState, buildAuthorizeUrl, exchangeCodeForTokens, startCallbackServer } = require("./spotify-auth");
const { spotifyRequest } = require("./spotify-request");
const { shapeSearchResults, shapeOwnPlaylists, mergePlaylists } = require("./spotify-shape");
const { AsyncDeviceDiscovery, Sonos } = require("sonos");
const { shapeZones, shapeTrack, isSpotifyTrack, upcomingQueueItems, shapeProgress } = require("./sonos-shape");
const { resolveKeyboardCommand } = require("./virtual-keyboard");

// Spotify requires HTTPS redirect URIs except for the loopback IP literal
// 127.0.0.1 (the hostname "localhost" is NOT exempted, even though it
// resolves to the same machine) — see RFC 8252 §8.3.
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:8888/callback";
const SCOPES = ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing", "playlist-read-private", "playlist-read-collaborative"];

module.exports = NodeHelper.create({
  start() {
    this.config = {};
    this.tokens = readTokenFile(this._tokenFilePath());
    this.profile = null;
    this.pollTimer = null;
    this.authServer = null;
    this.pendingLogin = null;
    this._refreshPromise = null;
    this.zones = [];
    this.sonosEntryPoint = null;
    this.keyboardProcess = null;
    this.activeDeviceId = null;
  },

  stop() {
    this._stopPolling();
    if (this.authServer) {
      this.authServer.close();
      this.authServer = null;
    }
    this._hideKeyboard();
  },

  socketNotificationReceived(notification, payload) {
    switch (notification) {
      case "SPOTIFY_CONFIG":
        this._configure(payload || {});
        break;
      case "SPOTIFY_LOGIN_START":
        this._startLogin();
        break;
      case "SPOTIFY_LOGOUT":
        this._logout();
        break;
      case "SPOTIFY_SEARCH":
        this._search(payload || {});
        break;
      case "SPOTIFY_DEVICES_REQUEST":
        this._refreshSonos();
        break;
      case "SPOTIFY_PLAY_NOW":
        this._playNow(payload || {});
        break;
      case "SPOTIFY_QUEUE_ADD":
        this._queueAdd(payload || {});
        break;
      case "SPOTIFY_PLAYPAUSE":
        this._playPause(payload || {});
        break;
      case "SPOTIFY_SKIP":
        this._skip(payload || {});
        break;
      case "SPOTIFY_KEYBOARD_SHOW":
        this._showKeyboard();
        break;
      case "SPOTIFY_KEYBOARD_HIDE":
        this._hideKeyboard();
        break;
      case "SPOTIFY_SET_ACTIVE_DEVICE":
        // Refresh immediately rather than waiting for the next poll tick (up
        // to pollInterval away) — otherwise picking a new speaker leaves the
        // overlay showing the PREVIOUS one's now-playing/progress/queue under
        // the new one's name for that whole interval.
        this.activeDeviceId = payload?.deviceId || null;
        this._refreshSonos();
        break;
    }
  },

  async _configure(config) {
    this.config = Object.assign(
      {
        redirectUri: DEFAULT_REDIRECT_URI,
        pollInterval: 7000,
        searchDebounce: 450,
        maxSearchResults: 10,
        sonosSpotifyRegion: "2311",
        sonosDiscoveryTimeout: 5000,
        virtualKeyboardCommand: null
      },
      config
    );

    if (!this.tokens) {
      this.sendSocketNotification("SPOTIFY_AUTH_STATE", { loggedIn: false, profile: null });
      return;
    }

    try {
      await this._getAccessToken();
      await this._fetchProfile();
      this._startPolling();
      this.sendSocketNotification("SPOTIFY_AUTH_STATE", { loggedIn: true, profile: this.profile });
    } catch (err) {
      if (this._isAuthRejection(err)) {
        Log.error(`[MMM-Spotify-Sonos] Stored token was rejected by Spotify: ${err.message}`);
        this._handleAuthFailure();
        return;
      }
      // Transient failure (network error, 5xx, an exhausted 429 retry, a /v1/me hiccup):
      // show the logged-out UI for now, but keep the refresh token on disk so a later
      // restart/reconfigure can recover without a manual GUI re-login.
      Log.error(`[MMM-Spotify-Sonos] Could not verify stored token (keeping it): ${err.message}`);
      this._stopPolling();
      this.profile = null;
      this.sendSocketNotification("SPOTIFY_AUTH_STATE", { loggedIn: false, profile: null });
    }
  },

  // Spotify's token endpoint answers a revoked/invalid refresh token with 400 or 401;
  // any other failure is transient and must not cost us the stored refresh token.
  // spotify-auth.js embeds the status code in the error message, which is this
  // codebase's existing convention for carrying status through a thrown Error.
  _isAuthRejection(err) {
    return /Spotify token endpoint returned (?:400|401)/.test(err?.message || "");
  },

  // Single teardown path for "we are definitively logged out", shared by an explicit
  // logout and by a refresh token Spotify has rejected.
  _handleAuthFailure() {
    this._stopPolling();
    this.tokens = null;
    this.profile = null;
    this._refreshPromise = null;
    // A different account logging back in shouldn't inherit this session's
    // speaker choice — it should go through the same "no zone selected yet,
    // auto-detect" bootstrap _refreshSonos() does for a genuinely fresh start.
    this.activeDeviceId = null;
    deleteTokenFile(this._tokenFilePath());
    this.sendSocketNotification("SPOTIFY_AUTH_STATE", { loggedIn: false, profile: null });
  },

  _tokenFilePath() {
    return path.join(__dirname, "spotify_access_token.json");
  },

  async _getAccessToken() {
    if (!this.tokens) throw new Error("Not logged in");
    if (isTokenExpired(this.tokens)) {
      await this._refreshTokensOnce();
      if (!this.tokens) throw new Error("Not logged in");
    }
    return this.tokens.accessToken;
  },

  // Concurrent callers share one in-flight refresh so they can't race each other on
  // the same (single-use, potentially rotating) refresh token.
  _refreshTokensOnce() {
    if (!this._refreshPromise) {
      this._refreshPromise = this._refreshTokens().finally(() => {
        this._refreshPromise = null;
      });
    }
    return this._refreshPromise;
  },

  async _refreshTokens() {
    const refreshed = await refreshAccessToken(fetch, {
      refreshToken: this.tokens.refreshToken,
      clientId: this.config.clientId
    });
    // A logout (or an auth failure on another request) while this was in flight wins —
    // don't resurrect the session or re-create the token file we just deleted.
    if (!this.tokens) throw new Error("Not logged in");
    this.tokens = refreshed;
    writeTokenFile(this._tokenFilePath(), this.tokens);
    return this.tokens;
  },

  async _spotifyFetch(path_, options = {}) {
    try {
      return await spotifyRequest(fetch, path_, options, {
        getAccessToken: () => this._getAccessToken(),
        onUnauthorized: () => this._refreshTokensOnce()
      });
    } catch (err) {
      // A refresh Spotify rejected outright means the stored token is dead for good,
      // no matter which request happened to discover it — fall back to the logged-out
      // UI here rather than in every caller. Transient failures just propagate.
      if (this._isAuthRejection(err)) this._handleAuthFailure();
      throw err;
    }
  },

  _stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  },

  async _startLogin() {
    if (!this.config.clientId) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: "Missing clientId in config" });
      return;
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();
    const redirectUri = this.config.redirectUri;
    const port = Number(new URL(redirectUri).port) || 8888;

    // A previous login attempt that was never completed still owns the port —
    // close it so a retry doesn't fail with EADDRINUSE.
    if (this.authServer) {
      this.authServer.close();
      this.authServer = null;
    }

    try {
      this.authServer = await startCallbackServer(port, (result) =>
        this._handleCallback(result, codeVerifier, state, redirectUri)
      );
    } catch (err) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Could not start OAuth callback server: ${err.message}` });
      return;
    }

    const authorizeUrl = buildAuthorizeUrl({
      clientId: this.config.clientId,
      redirectUri,
      codeChallenge,
      state,
      scopes: SCOPES
    });
    this.sendSocketNotification("SPOTIFY_AUTH_URL", { url: authorizeUrl });
  },

  async _handleCallback({ code, state, error }, expectedVerifier, expectedState, redirectUri) {
    if (this.authServer) {
      this.authServer.close();
      this.authServer = null;
    }

    if (error || !code || state !== expectedState) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Spotify login failed: ${error || "state mismatch"}` });
      return;
    }

    try {
      this.tokens = await exchangeCodeForTokens(fetch, {
        code,
        codeVerifier: expectedVerifier,
        redirectUri,
        clientId: this.config.clientId
      });
      writeTokenFile(this._tokenFilePath(), this.tokens);
      await this._fetchProfile();
      this._startPolling();
      this.sendSocketNotification("SPOTIFY_AUTH_STATE", { loggedIn: true, profile: this.profile });
    } catch (err) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Token exchange failed: ${err.message}` });
    }
  },

  async _fetchProfile() {
    const response = await this._spotifyFetch("/v1/me");
    if (!response.ok) throw new Error(`${response.status}`);
    const json = await response.json();
    this.profile = {
      id: json.id,
      displayName: json.display_name || json.id,
      avatarUrl: json.images?.[0]?.url || null
    };
    return this.profile;
  },

  _logout() {
    this._handleAuthFailure();
  },

  _startPolling() {
    this._stopPolling();
    this._refreshSonos();
    this.pollTimer = setInterval(() => this._refreshSonos(), this.config.pollInterval);
  },

  async _ensureSonosDevice() {
    if (this.sonosEntryPoint) return this.sonosEntryPoint;
    const discovery = new AsyncDeviceDiscovery();
    this.sonosEntryPoint = await discovery.discover({ timeout: this.config.sonosDiscoveryTimeout });
    return this.sonosEntryPoint;
  },

  _findZone(zoneId) {
    return (this.zones || []).find((z) => z.id === zoneId) || null;
  },

  _sonosForZone(zone) {
    const sonos = new Sonos(zone.coordinatorHost);
    sonos.setSpotifyRegion(this.config.sonosSpotifyRegion);
    return sonos;
  },

  _sendEmptySonosState() {
    this.sendSocketNotification("SPOTIFY_DEVICES_RESULT", { devices: [] });
    this._sendEmptyPlaybackAndQueue();
  },

  _sendEmptyPlaybackAndQueue() {
    this.sendSocketNotification("SPOTIFY_PLAYBACK_STATE", { isPlaying: false, device: null, track: null, progress: { position: null, duration: null } });
    this.sendSocketNotification("SPOTIFY_QUEUE_RESULT", { queue: [] });
  },

  // Reports the now-playing/progress/queue state for exactly this zone — never
  // borrowed from a different one. Confirmed live: selecting a zone that isn't
  // playing Spotify used to keep showing whatever zone WAS, under the newly
  // selected zone's name (e.g. picking an idle Kjøkkenhøyttaler while
  // Badhøyttaler was mid-playlist left the overlay claiming Kjøkkenhøyttaler
  // was playing Badhøyttaler's track). An empty/idle result here is correct
  // and expected whenever the selected zone isn't genuinely playing Spotify.
  async _reportZonePlayback(deviceId) {
    const zone = this._findZone(deviceId);
    if (!zone) {
      this._sendEmptyPlaybackAndQueue();
      return;
    }

    const coordinator = this._sonosForZone(zone);
    let track;
    try {
      track = await coordinator.currentTrack();
    } catch {
      this._sendEmptyPlaybackAndQueue();
      return;
    }

    // A URI can technically contain "spotify" (e.g. a stale "x-sonos-vli:" self-
    // reference left over on a speaker that was ungrouped mid-playback) while
    // carrying no resolvable title — that's not a presentable "now playing" zone,
    // so require both. This module is deliberately Spotify-only — a zone playing
    // radio/TV/line-in reports as idle here rather than showing that instead.
    if (!isSpotifyTrack(track) || !track?.title) {
      this._sendEmptyPlaybackAndQueue();
      return;
    }

    let state = "stopped";
    try {
      state = await coordinator.getCurrentState();
    } catch {
      // Leave state as "stopped" if we can't read it — still report the track.
    }

    this.sendSocketNotification("SPOTIFY_PLAYBACK_STATE", {
      isPlaying: state === "playing",
      device: { id: zone.id, name: zone.name },
      track: shapeTrack(track),
      progress: shapeProgress(track)
    });

    let queueItems = [];
    try {
      const queueResult = await coordinator.getQueue();
      queueItems = upcomingQueueItems(queueResult?.items, track.queuePosition).map(shapeTrack);
    } catch {
      // Queue read failures aren't fatal — just show an empty "up next" list.
    }
    this.sendSocketNotification("SPOTIFY_QUEUE_RESULT", { queue: queueItems });
  },

  // One tick: discover zones and report the device list, then report playback
  // for whichever zone is actually selected. Nothing selected yet (no login-
  // session pick made) falls back to auto-detecting whichever zone is playing
  // Spotify content, so a fresh overlay open lands on a sensible default —
  // matching "if music's already playing, use that speaker automatically".
  async _refreshSonos() {
    let entryPoint;
    try {
      entryPoint = await this._ensureSonosDevice();
    } catch (err) {
      Log.error(`[MMM-Spotify-Sonos] Sonos discovery failed: ${err.message}`);
      this._sendEmptySonosState();
      return;
    }

    let groups;
    try {
      groups = await entryPoint.getAllGroups();
    } catch (err) {
      Log.error(`[MMM-Spotify-Sonos] Could not read Sonos zones (retrying discovery next tick): ${err.message}`);
      this.sonosEntryPoint = null;
      return;
    }

    this.zones = shapeZones(groups);
    this.sendSocketNotification("SPOTIFY_DEVICES_RESULT", { devices: this.zones.map(({ id, name }) => ({ id, name })) });

    if (this.activeDeviceId) {
      await this._reportZonePlayback(this.activeDeviceId);
      return;
    }

    for (const group of groups) {
      // A group whose coordinator can't be resolved has nothing to read (and would
      // throw an unhandled rejection out of this un-awaited method, killing the tick).
      if (typeof group.CoordinatorDevice !== "function") continue;
      let track;
      try {
        track = await group.CoordinatorDevice().currentTrack();
      } catch {
        continue;
      }
      if (!isSpotifyTrack(track) || !track?.title) continue;
      await this._reportZonePlayback(group.ID);
      return;
    }

    // No zone is playing Spotify content.
    this._sendEmptyPlaybackAndQueue();
  },

  async _search({ query }) {
    if (!query || !query.trim()) {
      this.sendSocketNotification("SPOTIFY_SEARCH_RESULT", { tracks: [], playlists: [] });
      return;
    }

    const limit = this.config.maxSearchResults;
    // This app's current Spotify access level caps /v1/search's limit param at 10
    // (empirically verified — values above 10 return 400 "Invalid limit"), tighter
    // than Spotify's documented 1-50 range. Clamp defensively regardless of config
    // so a higher maxSearchResults doesn't just break search outright; the own-
    // playlist merge below still uses the full configured limit.
    const searchLimit = Math.min(limit, 10);
    try {
      const [searchResponse, ownPlaylistsResponse] = await Promise.all([
        this._spotifyFetch(`/v1/search?q=${encodeURIComponent(query)}&type=track,playlist&limit=${searchLimit}`),
        this._spotifyFetch("/v1/me/playlists?limit=50")
      ]);

      if (!searchResponse.ok) throw new Error(`${searchResponse.status}`);
      const shaped = shapeSearchResults(await searchResponse.json());

      let ownMatches = [];
      if (ownPlaylistsResponse.ok) {
        ownMatches = shapeOwnPlaylists(await ownPlaylistsResponse.json(), query);
      }

      const playlists = mergePlaylists(ownMatches, shaped.playlists, limit);
      this.sendSocketNotification("SPOTIFY_SEARCH_RESULT", { tracks: shaped.tracks, playlists });
    } catch (err) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Search failed: ${err.message}` });
    }
  },

  async _playNow({ deviceId, uri }) {
    const zone = this._findZone(deviceId);
    if (!zone) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: "No such speaker — pick one first" });
      return;
    }
    try {
      // setAVTransportURI(uri) alone plays the bare Spotify URI directly, bypassing
      // Sonos's own queue entirely — confirmed live: with playback sourced that way,
      // both explicit skip AND natural end-of-track auto-advance fail (UPnP error 711,
      // "transition not available"), even with tracks already sitting in the queue.
      // Routing through the queue instead — clear it, add this URI, switch the
      // transport to play from the queue, then play — makes "Play now" genuinely
      // replace what's playing (matching the original intent) while keeping skip and
      // auto-advance working for anything queued after it.
      const sonos = this._sonosForZone(zone);
      await sonos.flush();
      await sonos.queue(uri);
      await sonos.selectQueue();
      await sonos.play();
      // A playlist can take several seconds to start (Sonos has to expand it
      // before playback begins) with no other feedback on screen, so push the
      // new state out immediately instead of leaving the frontend to wait for
      // the next poll tick (up to `pollInterval` away) to find out it worked.
      await this._refreshSonos();
      this.sendSocketNotification("SPOTIFY_ACTION_DONE", { action: "playNow" });
    } catch (err) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Could not start playback: ${err.message}` });
    }
  },

  async _queueAdd({ uri, deviceId }) {
    const zone = this._findZone(deviceId);
    if (!zone) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: "No active speaker — pick one first" });
      return;
    }
    try {
      await this._sonosForZone(zone).queue(uri);
      await this._refreshSonos();
      this.sendSocketNotification("SPOTIFY_ACTION_DONE", { action: "queueAdd" });
    } catch (err) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Could not add to queue: ${err.message}` });
    }
  },

  async _playPause({ deviceId, isPlaying }) {
    const zone = this._findZone(deviceId);
    if (!zone) return;
    try {
      const sonos = this._sonosForZone(zone);
      if (isPlaying) {
        await sonos.pause();
      } else {
        await sonos.play();
      }
    } catch (err) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Could not toggle playback: ${err.message}` });
    }
  },

  // Electron doesn't invoke any OS on-screen keyboard on input focus, on any
  // platform — so on a touchscreen kiosk (the target device for this module)
  // nothing pops up when the search box is tapped unless something explicitly
  // shows one. This shells out to whatever virtual keyboard binary the user
  // configured (e.g. "matchbox-keyboard" on a Raspberry Pi) rather than
  // building one in-page, so it works with whatever the host OS already
  // provides. Left unconfigured (the default), both methods are no-ops.
  _showKeyboard() {
    if (this.keyboardProcess) return; // already showing
    const resolved = resolveKeyboardCommand(this.config.virtualKeyboardCommand);
    if (!resolved) return; // feature not configured

    let child;
    try {
      child = spawn(resolved.command, resolved.args, { stdio: "ignore" });
    } catch (err) {
      Log.warn(`[MMM-Spotify-Sonos] Could not start virtual keyboard "${resolved.command}": ${err.message}`);
      return;
    }
    this.keyboardProcess = child;
    child.on("error", (err) => {
      Log.warn(`[MMM-Spotify-Sonos] Could not start virtual keyboard "${resolved.command}": ${err.message}`);
      if (this.keyboardProcess === child) this.keyboardProcess = null;
    });
    // The user's own keyboard has a close button too — this keeps our
    // reference from going stale if they use it instead of tapping away.
    child.on("exit", () => {
      if (this.keyboardProcess === child) this.keyboardProcess = null;
    });
  },

  _hideKeyboard() {
    if (!this.keyboardProcess) return;
    this.keyboardProcess.kill();
    this.keyboardProcess = null;
  },

  async _skip({ deviceId, direction }) {
    const zone = this._findZone(deviceId);
    if (!zone) return;
    try {
      const sonos = this._sonosForZone(zone);
      if (direction === "previous") {
        await sonos.previous();
      } else {
        await sonos.next();
      }
    } catch (err) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Could not skip: ${err.message}` });
    }
  }
});
