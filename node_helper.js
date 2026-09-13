"use strict";

const NodeHelper = require("node_helper");
const Log = require("logger");
const path = require("node:path");
const { isTokenExpired, readTokenFile, writeTokenFile, deleteTokenFile, refreshAccessToken } = require("./spotify-auth");
const { spotifyRequest } = require("./spotify-request");

const DEFAULT_REDIRECT_URI = "http://localhost:8888/callback";

module.exports = NodeHelper.create({
  start() {
    this.config = {};
    this.tokens = readTokenFile(this._tokenFilePath());
    this.profile = null;
    this.pollTimer = null;
    this.authServer = null;
    this.pendingLogin = null;
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
      this.sendSocketNotification("SPOTIFY_AUTH_STATE", { loggedIn: true, profile: this.profile });
    } catch (err) {
      Log.error(`[MMM-Spotify-Sonos] Stored token is no longer valid: ${err.message}`);
      this.tokens = null;
      deleteTokenFile(this._tokenFilePath());
      this.sendSocketNotification("SPOTIFY_AUTH_STATE", { loggedIn: false, profile: null });
    }
  },

  _tokenFilePath() {
    return path.join(__dirname, "spotify_access_token.json");
  },

  async _getAccessToken() {
    if (!this.tokens) throw new Error("Not logged in");
    if (isTokenExpired(this.tokens)) {
      await this._refreshTokens();
    }
    return this.tokens.accessToken;
  },

  async _refreshTokens() {
    this.tokens = await refreshAccessToken(fetch, {
      refreshToken: this.tokens.refreshToken,
      clientId: this.config.clientId
    });
    writeTokenFile(this._tokenFilePath(), this.tokens);
    return this.tokens;
  },

  async _spotifyFetch(path_, options = {}) {
    return spotifyRequest(fetch, path_, options, {
      getAccessToken: () => this._getAccessToken(),
      onUnauthorized: () => this._refreshTokens()
    });
  },

  _stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
});
