"use strict";

const NodeHelper = require("node_helper");
const Log = require("logger");
const path = require("node:path");
const { isTokenExpired, readTokenFile, writeTokenFile, deleteTokenFile, refreshAccessToken, generateCodeVerifier, generateCodeChallenge, generateState, buildAuthorizeUrl, exchangeCodeForTokens, startCallbackServer } = require("./spotify-auth");
const { spotifyRequest } = require("./spotify-request");
const { shapePlaybackState, shapeSearchResults, shapeOwnPlaylists, mergePlaylists, shapeDevices, shapeQueueResponse } = require("./spotify-shape");

const DEFAULT_REDIRECT_URI = "http://localhost:8888/callback";
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
  },

  stop() {
    this._stopPolling();
    if (this.authServer) {
      this.authServer.close();
      this.authServer = null;
    }
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
        this._getDevices();
        break;
      case "SPOTIFY_TRANSFER":
        this._transfer(payload || {});
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
    }
  },

  async _configure(config) {
    this.config = Object.assign(
      {
        redirectUri: DEFAULT_REDIRECT_URI,
        pollInterval: 7000,
        searchDebounce: 450,
        maxSearchResults: 12
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
    if (!response.ok) throw new Error(`Failed to fetch profile: ${response.status}`);
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
    this._poll();
    this.pollTimer = setInterval(() => this._poll(), this.config.pollInterval);
  },

  // One tick: now-playing state and the "up next" queue, on the same timer.
  _poll() {
    this._pollPlaybackState();
    this._pollQueue();
  },

  async _pollPlaybackState() {
    try {
      const response = await this._spotifyFetch("/v1/me/player");
      if (response.status === 204) {
        this.sendSocketNotification("SPOTIFY_PLAYBACK_STATE", { isPlaying: false, device: null, track: null });
        return;
      }
      if (!response.ok) throw new Error(`Playback state request failed: ${response.status}`);
      const json = await response.json();
      this.sendSocketNotification("SPOTIFY_PLAYBACK_STATE", shapePlaybackState(json));
    } catch (err) {
      Log.error(`[MMM-Spotify-Sonos] Failed to poll playback state: ${err.message}`);
      // Transient failures simply retry on the next tick. A rejected refresh token is
      // terminal — _spotifyFetch normally escalates it already, this covers any that
      // reach us another way (and is a no-op once the tokens are gone).
      if (this.tokens && this._isAuthRejection(err)) this._handleAuthFailure();
    }
  },

  async _pollQueue() {
    try {
      const response = await this._spotifyFetch("/v1/me/player/queue");
      if (response.status === 204) {
        this.sendSocketNotification("SPOTIFY_QUEUE_RESULT", { currentlyPlaying: null, queue: [] });
        return;
      }
      if (!response.ok) throw new Error(`Queue request failed: ${response.status}`);
      const json = await response.json();
      this.sendSocketNotification("SPOTIFY_QUEUE_RESULT", shapeQueueResponse(json));
    } catch (err) {
      Log.error(`[MMM-Spotify-Sonos] Failed to poll queue: ${err.message}`);
      if (this.tokens && this._isAuthRejection(err)) this._handleAuthFailure();
    }
  },

  async _search({ query }) {
    if (!query || !query.trim()) {
      this.sendSocketNotification("SPOTIFY_SEARCH_RESULT", { tracks: [], playlists: [] });
      return;
    }

    const limit = this.config.maxSearchResults;
    try {
      const [searchResponse, ownPlaylistsResponse] = await Promise.all([
        this._spotifyFetch(`/v1/search?q=${encodeURIComponent(query)}&type=track,playlist&limit=${limit}`),
        this._spotifyFetch("/v1/me/playlists?limit=50")
      ]);

      if (!searchResponse.ok) throw new Error(`Search failed: ${searchResponse.status}`);
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

  async _getDevices() {
    try {
      const response = await this._spotifyFetch("/v1/me/player/devices");
      if (!response.ok) throw new Error(`Devices request failed: ${response.status}`);
      const json = await response.json();
      this.sendSocketNotification("SPOTIFY_DEVICES_RESULT", { devices: shapeDevices(json) });
    } catch (err) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Could not load devices: ${err.message}` });
    }
  },

  async _transfer({ deviceId }) {
    try {
      const response = await this._spotifyFetch("/v1/me/player", {
        method: "PUT",
        body: JSON.stringify({ device_ids: [deviceId], play: false })
      });
      if (!response.ok && response.status !== 204) throw new Error(`Transfer failed: ${response.status}`);
    } catch (err) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Could not switch speaker: ${err.message}` });
    }
  },

  async _playNow({ deviceId, uri, type }) {
    try {
      const body = type === "playlist" ? { context_uri: uri } : { uris: [uri] };
      const response = await this._spotifyFetch(`/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: "PUT",
        body: JSON.stringify(body)
      });
      if (!response.ok && response.status !== 204) throw new Error(`Play failed: ${response.status}`);
    } catch (err) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Could not start playback: ${err.message}` });
    }
  },

  async _queueAdd({ uri, deviceId }) {
    try {
      let requestPath = `/v1/me/player/queue?uri=${encodeURIComponent(uri)}`;
      if (deviceId) requestPath += `&device_id=${encodeURIComponent(deviceId)}`;
      const response = await this._spotifyFetch(requestPath, { method: "POST" });
      if (response.status === 404) {
        this.sendSocketNotification("SPOTIFY_ERROR", { message: "No active speaker — pick one first" });
        return;
      }
      if (!response.ok && response.status !== 204) throw new Error(`Queue add failed: ${response.status}`);
    } catch (err) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Could not add to queue: ${err.message}` });
    }
  },

  async _playPause({ isPlaying }) {
    try {
      const endpoint = isPlaying ? "/v1/me/player/pause" : "/v1/me/player/play";
      const response = await this._spotifyFetch(endpoint, { method: "PUT" });
      if (!response.ok && response.status !== 204) throw new Error(`Play/pause failed: ${response.status}`);
    } catch (err) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Could not toggle playback: ${err.message}` });
    }
  },

  async _skip({ direction }) {
    try {
      const endpoint = direction === "previous" ? "/v1/me/player/previous" : "/v1/me/player/next";
      const response = await this._spotifyFetch(endpoint, { method: "POST" });
      if (!response.ok && response.status !== 204) throw new Error(`Skip failed: ${response.status}`);
    } catch (err) {
      this.sendSocketNotification("SPOTIFY_ERROR", { message: `Could not skip: ${err.message}` });
    }
  }
});
