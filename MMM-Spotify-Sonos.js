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
    this.searchResults = { tracks: [], playlists: [] };
    this._searchDebounceTimer = null;
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
      case "SPOTIFY_SEARCH_RESULT":
        this.searchResults = payload;
        this._renderOverlayBody();
        break;
    }
  },

  _debouncedSearch(query) {
    if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
    this._searchDebounceTimer = setTimeout(() => {
      this.sendSocketNotification("SPOTIFY_SEARCH", { query });
    }, this.config.searchDebounce);
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

  _buildSearchBox() {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "mmm-spotify-sonos__search-input";
    input.placeholder = this.translate("SEARCH_PLACEHOLDER");
    input.addEventListener("input", () => this._debouncedSearch(input.value));
    return input;
  },

  _buildResultTile(item) {
    const tile = document.createElement("div");
    tile.className = "mmm-spotify-sonos__result-tile";

    if (item.imageUrl) {
      const image = document.createElement("img");
      image.className = "mmm-spotify-sonos__result-image";
      image.src = item.imageUrl;
      tile.appendChild(image);
    }

    const info = document.createElement("div");
    info.className = "mmm-spotify-sonos__result-info";
    const name = document.createElement("div");
    name.className = "mmm-spotify-sonos__result-name";
    name.innerText = item.name;
    info.appendChild(name);
    const subtitle = document.createElement("div");
    subtitle.className = "mmm-spotify-sonos__result-subtitle";
    subtitle.innerText = item.type === "track" ? item.artist : item.owner;
    info.appendChild(subtitle);
    tile.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "mmm-spotify-sonos__result-actions";

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "mmm-spotify-sonos__result-action";
    playBtn.innerText = this.translate("PLAY_NOW");
    playBtn.addEventListener("click", () => this._handlePlayNow(item));
    actions.appendChild(playBtn);

    const queueBtn = document.createElement("button");
    queueBtn.type = "button";
    queueBtn.className = "mmm-spotify-sonos__result-action";
    queueBtn.innerText = this.translate("ADD_TO_QUEUE");
    queueBtn.addEventListener("click", () => this._handleQueueAdd(item));
    actions.appendChild(queueBtn);

    tile.appendChild(actions);
    return tile;
  },

  _handlePlayNow(item) {
    if (!this.activeDeviceId) {
      const picker = this._overlayBodyEl?.querySelector(".mmm-spotify-sonos__device-picker-list");
      if (picker) picker.hidden = false;
      return;
    }
    this.sendSocketNotification("SPOTIFY_PLAY_NOW", { deviceId: this.activeDeviceId, uri: item.uri, type: item.type });
  },

  _handleQueueAdd(item) {
    if (!this.activeDeviceId) {
      this.lastError = this.translate("NO_ACTIVE_SPEAKER");
      this._renderOverlayBody();
      return;
    }
    this.sendSocketNotification("SPOTIFY_QUEUE_ADD", { uri: item.uri, deviceId: this.activeDeviceId });
  },

  _buildResultsSection() {
    const section = document.createElement("div");
    section.className = "mmm-spotify-sonos__results";

    const tracksHeading = document.createElement("h3");
    tracksHeading.innerText = this.translate("TRACKS");
    section.appendChild(tracksHeading);
    const tracksRow = document.createElement("div");
    tracksRow.className = "mmm-spotify-sonos__results-row";
    this.searchResults.tracks.forEach((track) => tracksRow.appendChild(this._buildResultTile(track)));
    section.appendChild(tracksRow);

    const playlistsHeading = document.createElement("h3");
    playlistsHeading.innerText = this.translate("PLAYLISTS");
    section.appendChild(playlistsHeading);
    const playlistsRow = document.createElement("div");
    playlistsRow.className = "mmm-spotify-sonos__results-row";
    this.searchResults.playlists.forEach((playlist) => playlistsRow.appendChild(this._buildResultTile(playlist)));
    section.appendChild(playlistsRow);

    return section;
  },

  _renderOverlayBody() {
    if (!this._overlayBodyEl) return;
    this._overlayBodyEl.innerHTML = "";
    this._overlayBodyEl.appendChild(this._buildDevicePicker());
    this._overlayBodyEl.appendChild(this._buildNowPlayingControls());
    this._overlayBodyEl.appendChild(this._buildSearchBox());

    if (this.lastError) {
      const errorEl = document.createElement("div");
      errorEl.className = "mmm-spotify-sonos__overlay-error";
      errorEl.innerText = this.lastError;
      this._overlayBodyEl.appendChild(errorEl);
    }

    this._overlayBodyEl.appendChild(this._buildResultsSection());
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
