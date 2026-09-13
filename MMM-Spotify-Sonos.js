"use strict";

Module.register("MMM-Spotify-Sonos", {
  defaults: {
    clientId: null,
    redirectUri: "http://localhost:8888/callback",
    pollInterval: 7000,
    searchDebounce: 450,
    maxSearchResults: 12
  },

  start() {
    this.loggedIn = false;
    this.profile = null;
    this.playback = { isPlaying: false, device: null, track: null };
    this.lastError = null;
    this.overlayOpen = false;
    this.sendSocketNotification("SPOTIFY_CONFIG", this.config);
  },

  getStyles() {
    return ["MMM-Spotify-Sonos.css"];
  },

  getTranslations() {
    return {
      en: "translations/en.json",
      nb: "translations/nb.json"
    };
  },

  socketNotificationReceived(notification, payload) {
    switch (notification) {
      case "SPOTIFY_AUTH_STATE":
        this.loggedIn = payload.loggedIn;
        this.profile = payload.profile;
        this.updateDom();
        break;
      case "SPOTIFY_AUTH_URL":
        window.open(payload.url, "SpotifyLogin", "width=500,height=700");
        break;
      case "SPOTIFY_PLAYBACK_STATE":
        this.playback = payload;
        this.updateDom();
        break;
      case "SPOTIFY_ERROR":
        this.lastError = payload.message;
        Log.error(`[MMM-Spotify-Sonos] ${payload.message}`);
        this.updateDom();
        break;
    }
  },

  _requestLogin() {
    this.sendSocketNotification("SPOTIFY_LOGIN_START");
  },

  _requestLogout() {
    this.sendSocketNotification("SPOTIFY_LOGOUT");
  },

  _buildIdleWidget() {
    const widget = document.createElement("div");
    widget.className = "mmm-spotify-sonos__widget";

    const icon = document.createElement("span");
    icon.className = "mmm-spotify-sonos__icon";
    icon.innerText = "♫";
    widget.appendChild(icon);

    if (this.loggedIn) {
      if (this.profile?.avatarUrl) {
        const avatar = document.createElement("img");
        avatar.className = "mmm-spotify-sonos__avatar";
        avatar.src = this.profile.avatarUrl;
        widget.appendChild(avatar);
      }
      const name = document.createElement("span");
      name.className = "mmm-spotify-sonos__account-name";
      name.innerText = this.profile?.displayName || "";
      widget.appendChild(name);
      widget.addEventListener("click", () => this._openOverlay());
    } else {
      const loginLabel = document.createElement("span");
      loginLabel.className = "mmm-spotify-sonos__login-label";
      loginLabel.innerText = this.translate("LOG_IN_WITH_SPOTIFY");
      widget.appendChild(loginLabel);
      widget.addEventListener("click", () => this._requestLogin());
    }

    return widget;
  },

  _buildNowPlayingStrip() {
    const strip = document.createElement("div");
    strip.className = "mmm-spotify-sonos__widget mmm-spotify-sonos__now-playing";
    strip.addEventListener("click", () => this._openOverlay());

    if (this.playback.track?.imageUrl) {
      const cover = document.createElement("img");
      cover.className = "mmm-spotify-sonos__cover";
      cover.src = this.playback.track.imageUrl;
      strip.appendChild(cover);
    }

    const info = document.createElement("div");
    info.className = "mmm-spotify-sonos__now-playing-info";

    const title = document.createElement("div");
    title.className = "mmm-spotify-sonos__now-playing-title";
    title.innerText = this.playback.track?.name || "";
    info.appendChild(title);

    const artist = document.createElement("div");
    artist.className = "mmm-spotify-sonos__now-playing-artist";
    artist.innerText = this.playback.track?.artist || "";
    info.appendChild(artist);

    strip.appendChild(info);

    if (this.playback.device?.name) {
      const deviceChip = document.createElement("span");
      deviceChip.className = "mmm-spotify-sonos__device-chip";
      deviceChip.innerText = this.playback.device.name;
      strip.appendChild(deviceChip);
    }

    return strip;
  },

  _openOverlay() {
    // Implemented in Task 12.
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-spotify-sonos";

    if (this.loggedIn && this.playback.track) {
      wrapper.appendChild(this._buildNowPlayingStrip());
    } else {
      wrapper.appendChild(this._buildIdleWidget());
    }

    return wrapper;
  }
});
