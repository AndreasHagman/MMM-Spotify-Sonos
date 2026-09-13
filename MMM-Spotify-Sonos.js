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
    this.devices = [];
    this.activeDeviceId = null;
    this._overlayEl = null;
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
      case "SPOTIFY_DEVICES_RESULT":
        this.devices = payload.devices;
        if (!this.activeDeviceId) {
          const active = this.devices.find((d) => d.isActive);
          if (active) this.activeDeviceId = active.id;
        }
        this._renderOverlayBody();
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
    if (this._overlayEl) return;
    this.overlayOpen = true;

    const backdrop = document.createElement("div");
    backdrop.className = "mmm-spotify-sonos__overlay-backdrop";
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) this._closeOverlay();
    });

    const sheet = document.createElement("div");
    sheet.className = "mmm-spotify-sonos__overlay-sheet";

    const header = document.createElement("div");
    header.className = "mmm-spotify-sonos__overlay-header";

    const title = document.createElement("span");
    title.className = "mmm-spotify-sonos__overlay-title";
    title.innerText = "Spotify";
    header.appendChild(title);

    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "mmm-spotify-sonos__overlay-logout";
    logoutBtn.innerText = this.translate("LOG_OUT");
    logoutBtn.addEventListener("click", () => this._requestLogout());
    header.appendChild(logoutBtn);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "mmm-spotify-sonos__overlay-close";
    closeBtn.innerText = "×";
    closeBtn.setAttribute("aria-label", this.translate("CLOSE"));
    closeBtn.addEventListener("click", () => this._closeOverlay());
    header.appendChild(closeBtn);

    sheet.appendChild(header);

    const body = document.createElement("div");
    body.className = "mmm-spotify-sonos__overlay-body";
    sheet.appendChild(body);

    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);

    this._overlayEl = backdrop;
    this._overlayBodyEl = body;

    this.sendSocketNotification("SPOTIFY_DEVICES_REQUEST");
    this._renderOverlayBody();
  },

  _closeOverlay() {
    this.overlayOpen = false;
    if (this._overlayEl) {
      this._overlayEl.remove();
      this._overlayEl = null;
      this._overlayBodyEl = null;
    }
  },

  _buildDevicePicker() {
    const container = document.createElement("div");
    container.className = "mmm-spotify-sonos__device-picker";

    const activeDevice = this.devices.find((d) => d.id === this.activeDeviceId);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "mmm-spotify-sonos__device-picker-toggle";
    toggle.innerText = `${this.translate("PLAYING_ON")}: ${activeDevice ? activeDevice.name : "—"} ▾`;

    const list = document.createElement("div");
    list.className = "mmm-spotify-sonos__device-picker-list";
    list.hidden = true;

    if (this.devices.length === 0) {
      const empty = document.createElement("div");
      empty.className = "mmm-spotify-sonos__device-picker-empty";
      empty.innerText = this.translate("NO_DEVICES_FOUND");
      list.appendChild(empty);
    }

    this.devices.forEach((device) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "mmm-spotify-sonos__device-picker-item";
      item.innerText = device.name;
      item.addEventListener("click", () => {
        this.activeDeviceId = device.id;
        this.sendSocketNotification("SPOTIFY_TRANSFER", { deviceId: device.id });
        list.hidden = true;
        this._renderOverlayBody();
      });
      list.appendChild(item);
    });

    toggle.addEventListener("click", () => {
      list.hidden = !list.hidden;
    });

    container.appendChild(toggle);
    container.appendChild(list);
    return container;
  },

  _buildNowPlayingControls() {
    const controls = document.createElement("div");
    controls.className = "mmm-spotify-sonos__overlay-controls";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "mmm-spotify-sonos__control-btn";
    prevBtn.innerText = "⏮";
    prevBtn.addEventListener("click", () => this.sendSocketNotification("SPOTIFY_SKIP", { direction: "previous" }));
    controls.appendChild(prevBtn);

    const isPlaying = this.playback.isPlaying;
    const playPauseBtn = document.createElement("button");
    playPauseBtn.type = "button";
    playPauseBtn.className = "mmm-spotify-sonos__control-btn mmm-spotify-sonos__control-btn--primary";
    playPauseBtn.innerText = isPlaying ? "⏸" : "▶";
    playPauseBtn.addEventListener("click", () => {
      // Optimistic flip — SPOTIFY_PLAYBACK_STATE will correct it on the next poll tick.
      this.playback = { ...this.playback, isPlaying: !isPlaying };
      this.sendSocketNotification("SPOTIFY_PLAYPAUSE", { isPlaying });
      this._renderOverlayBody();
    });
    controls.appendChild(playPauseBtn);

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "mmm-spotify-sonos__control-btn";
    nextBtn.innerText = "⏭";
    nextBtn.addEventListener("click", () => this.sendSocketNotification("SPOTIFY_SKIP", { direction: "next" }));
    controls.appendChild(nextBtn);

    return controls;
  },

  _renderOverlayBody() {
    if (!this._overlayBodyEl) return;
    this._overlayBodyEl.innerHTML = "";
    this._overlayBodyEl.appendChild(this._buildDevicePicker());
    this._overlayBodyEl.appendChild(this._buildNowPlayingControls());
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
