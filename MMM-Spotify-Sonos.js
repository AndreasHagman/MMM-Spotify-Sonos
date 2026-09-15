"use strict";

Module.register("MMM-Spotify-Sonos", {
  defaults: {
    clientId: null,
    redirectUri: "http://127.0.0.1:8888/callback",
    pollInterval: 7000,
    searchDebounce: 450,
    maxSearchResults: 10,
    sonosSpotifyRegion: "2311",
    sonosDiscoveryTimeout: 5000,
    virtualKeyboardCommand: null,
    maxQueueItemsShown: 5
  },

  start() {
    this.loggedIn = false;
    this.profile = null;
    this.playback = { isPlaying: false, device: null, track: null };
    this.progress = { position: null, duration: null };
    this._progressReceivedAt = null;
    this._progressTimer = null;
    this.lastError = null;
    this.overlayOpen = false;
    this.devices = [];
    this.activeDeviceId = null;
    this._overlayEl = null;
    this.searchResults = { tracks: [], playlists: [] };
    this.queue = { queue: [] };
    this._searchDebounceTimer = null;
    this._queueExpanded = false;
    this._devicePickerExpanded = false;
    this.sendSocketNotification("SPOTIFY_CONFIG", this.config);
  },

  getStyles() {
    return [this.file("css/MMM-Spotify-Sonos.css")];
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
        if (payload.loggedIn === false) this._resetAccountState();
        this.updateDom();
        break;
      case "SPOTIFY_AUTH_URL":
        window.open(payload.url, "SpotifyLogin", "width=500,height=700");
        break;
      case "SPOTIFY_PLAYBACK_STATE":
        // Deliberately does NOT clear lastError: this fires on every poll tick
        // (every pollInterval, unrelated to any user action), so clearing it here
        // made real errors vanish on their own before anyone could read them.
        // An error only clears when the specific action that caused it succeeds
        // (see the SPOTIFY_SEARCH_RESULT case below).
        this.playback = payload;
        // Baseline for the progress bar's between-poll interpolation (see
        // _currentElapsed) — recorded fresh on every poll tick regardless of
        // whether position actually changed, so drift never accumulates.
        this.progress = payload.progress || { position: null, duration: null };
        this._progressReceivedAt = Date.now();
        // If nothing has been explicitly picked yet, adopt whichever zone is playing
        // Spotify content as the default target — this only fires once, the first
        // time a Spotify session is detected; after that the user (or this initial
        // adoption) owns activeDeviceId until they pick a different zone or log out.
        // Telling the backend locks it in server-side too, so node_helper reports
        // THIS zone specifically on every future tick instead of re-scanning all
        // zones for "whichever one happens to be playing Spotify" indefinitely.
        if (!this.activeDeviceId && payload.device) {
          this.activeDeviceId = payload.device.id;
          this.sendSocketNotification("SPOTIFY_SET_ACTIVE_DEVICE", { deviceId: this.activeDeviceId });
        }
        this.updateDom();
        this._renderNowPlayingInfo();
        this._renderProgress();
        this._renderNowPlayingControls();
        this._renderDevicePicker();
        this._renderError();
        break;
      case "SPOTIFY_ERROR":
        this.lastError = payload.message;
        Log.error(`[MMM-Spotify-Sonos] ${payload.message}`);
        this.updateDom();
        this._renderError();
        this._clearBusyButtons();
        break;
      // Sent once a Play now / Add to queue / speaker switch call actually
      // finishes talking to Sonos — a single track (or a switch with nothing
      // to move) resolves almost immediately, but a playlist, or a large
      // queue moving to a new speaker, can take several seconds, and without
      // this nothing gave any sign something was happening at all.
      case "SPOTIFY_ACTION_DONE":
        this._clearBusyButtons();
        this._clearSpeakerSwitching();
        break;
      case "SPOTIFY_DEVICES_RESULT":
        this.devices = payload.devices;
        this._renderDevicePicker();
        this._renderError();
        break;
      case "SPOTIFY_SEARCH_RESULT":
        this.lastError = null;
        this.searchResults = payload;
        this._renderResults();
        this._renderError();
        break;
      case "SPOTIFY_QUEUE_RESULT":
        this.queue = payload;
        this._renderQueue();
        break;
    }
  },

  // Everything tied to the account that just went away, so a login by a different
  // account can't show the previous session's devices/results/queue.
  _resetAccountState() {
    this._closeOverlay();
    this.devices = [];
    this.activeDeviceId = null;
    this.searchResults = { tracks: [], playlists: [] };
    this.queue = { queue: [] };
    // Without this, getDom()'s `loggedIn && playback.track` check goes true the
    // instant a new login lands and shows the PREVIOUS session's track/device
    // until the next poll tick replaces it.
    this.playback = { isPlaying: false, device: null, track: null };
    this.progress = { position: null, duration: null };
    this._progressReceivedAt = null;
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

    // Stable sub-containers, built exactly once per overlay-open. Each is re-rendered
    // independently by its own _renderX() so that nothing — the search input above
    // all — gets destroyed just because some other part of the overlay updated.
    this._devicePickerEl = document.createElement("div");
    this._devicePickerEl.className = "mmm-spotify-sonos__device-picker";
    body.appendChild(this._devicePickerEl);

    // Now-playing panel (left: cover/title/artist, progress bar, transport
    // controls) and queue (right) share a row instead of each taking a
    // full-width block stacked on its own — a long "Up next" list otherwise
    // pushed search/results well below the fold.
    const topRow = document.createElement("div");
    topRow.className = "mmm-spotify-sonos__top-row";
    body.appendChild(topRow);

    const nowPlayingPanel = document.createElement("div");
    nowPlayingPanel.className = "mmm-spotify-sonos__now-playing-panel";
    topRow.appendChild(nowPlayingPanel);

    this._nowPlayingInfoEl = document.createElement("div");
    this._nowPlayingInfoEl.className = "mmm-spotify-sonos__now-playing-panel-info";
    nowPlayingPanel.appendChild(this._nowPlayingInfoEl);

    this._progressEl = document.createElement("div");
    this._progressEl.className = "mmm-spotify-sonos__progress";
    nowPlayingPanel.appendChild(this._progressEl);

    this._nowPlayingControlsEl = document.createElement("div");
    this._nowPlayingControlsEl.className = "mmm-spotify-sonos__overlay-controls";
    nowPlayingPanel.appendChild(this._nowPlayingControlsEl);

    this._queueEl = document.createElement("div");
    this._queueEl.className = "mmm-spotify-sonos__queue";
    topRow.appendChild(this._queueEl);

    // Created once and never rebuilt, so typing (focus, caret, keyboard) survives
    // search results arriving.
    this._searchInputEl = this._buildSearchBox();
    body.appendChild(this._searchInputEl);

    this._errorEl = document.createElement("div");
    this._errorEl.className = "mmm-spotify-sonos__overlay-error";
    this._errorEl.hidden = true;
    body.appendChild(this._errorEl);

    this._resultsEl = document.createElement("div");
    this._resultsEl.className = "mmm-spotify-sonos__results";
    body.appendChild(this._resultsEl);

    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);

    this._overlayEl = backdrop;
    this._overlayBodyEl = body;

    this.sendSocketNotification("SPOTIFY_DEVICES_REQUEST");
    this._renderDevicePicker();
    this._renderNowPlayingInfo();
    this._renderProgress();
    this._renderNowPlayingControls();
    this._renderError();
    this._renderQueue();
    this._renderResults();
    // Position/duration only arrive on poll ticks (up to `pollInterval` apart),
    // which would make the bar visibly jump instead of moving smoothly — this
    // repaints it every second from the last known baseline in between.
    this._progressTimer = setInterval(() => this._renderProgress(), 1000);
  },

  _closeOverlay() {
    this.overlayOpen = false;
    // Both start collapsed again next time the overlay opens, rather than
    // carrying over whatever was expanded from a previous visit.
    this._queueExpanded = false;
    this._devicePickerExpanded = false;
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }
    if (this._overlayEl) {
      // Removing a focused input from the DOM doesn't reliably fire its own
      // "blur" first (browser-dependent), so this is the backstop that keeps
      // a virtual keyboard from being left open behind a closed overlay.
      this.sendSocketNotification("SPOTIFY_KEYBOARD_HIDE");
      this._overlayEl.remove();
      this._overlayEl = null;
      this._overlayBodyEl = null;
      this._devicePickerEl = null;
      this._nowPlayingInfoEl = null;
      this._progressEl = null;
      this._nowPlayingControlsEl = null;
      this._searchInputEl = null;
      this._deviceListEl = null;
      this._errorEl = null;
      this._queueEl = null;
      this._resultsEl = null;
    }
  },

  _renderDevicePicker() {
    if (!this._devicePickerEl) return;
    const container = this._devicePickerEl;
    container.innerHTML = "";

    // A Sonos zone id is always real (never null the way a Spotify Connect device id
    // could be), so activeDeviceId reliably matches an entry in this.devices once set
    // — no fallback needed here.
    const activeDevice = this.devices.find((d) => d.id === this.activeDeviceId);

    // A single row: the current speaker as plain text, and a separate button
    // to reveal the picker — rather than one big toggle pill — so the active
    // speaker's name doesn't look like part of a control you have to tap.
    const row = document.createElement("div");
    row.className = "mmm-spotify-sonos__device-picker-row";

    const label = document.createElement("span");
    label.className = "mmm-spotify-sonos__device-picker-label";
    label.innerText = `${this.translate("PLAYING_ON")}: ${activeDevice?.name || "—"}`;
    row.appendChild(label);

    const list = document.createElement("div");
    list.className = "mmm-spotify-sonos__device-picker-list";
    // Rebuilt (and this.devices.length === 0) on every poll tick, so this state
    // has to live on `this`, not just on the DOM node, or an unrelated re-render
    // would silently close it again a few seconds after opening it.
    list.hidden = !this._devicePickerExpanded;

    const changeBtn = document.createElement("button");
    changeBtn.type = "button";
    changeBtn.className = "mmm-spotify-sonos__device-picker-toggle";
    changeBtn.innerText = this.translate("CHANGE_SPEAKER");
    changeBtn.addEventListener("click", () => {
      this._devicePickerExpanded = !this._devicePickerExpanded;
      list.hidden = !this._devicePickerExpanded;
    });
    row.appendChild(changeBtn);

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
        this._devicePickerExpanded = false;
        // Tell the backend so it reports THIS zone's playback/queue specifically —
        // otherwise the overlay kept showing whichever zone was ACTUALLY playing
        // Spotify, mislabeled under the newly picked zone's name, until that other
        // zone stopped.
        this.sendSocketNotification("SPOTIFY_SET_ACTIVE_DEVICE", { deviceId: this.activeDeviceId });
        // Full re-render (not just hiding the list) so the "Playing on: X"
        // label picks up the new selection immediately.
        this._renderDevicePicker();
        // Moving a large queue to the new speaker can take several seconds
        // with nothing else on screen to show for it — cleared by
        // SPOTIFY_ACTION_DONE once the backend confirms it's actually done
        // (near-instant if this wasn't a real transfer, so the indicator
        // just never has time to show in that case).
        this._setSpeakerSwitching();
      });
      list.appendChild(item);
    });

    container.appendChild(row);
    container.appendChild(list);
    this._deviceListEl = list;
  },

  // Cover/title/artist for whatever's actually playing, inside the overlay
  // itself — previously only visible on the collapsed strip behind it (which
  // the overlay's own backdrop dims), so opening the overlay lost sight of
  // what was playing entirely.
  _renderNowPlayingInfo() {
    if (!this._nowPlayingInfoEl) return;
    const el = this._nowPlayingInfoEl;
    el.innerHTML = "";

    const track = this.playback?.track;
    if (!track?.name) {
      el.hidden = true;
      return;
    }
    el.hidden = false;

    if (track.imageUrl) {
      const cover = document.createElement("img");
      cover.className = "mmm-spotify-sonos__now-playing-panel-cover";
      cover.src = track.imageUrl;
      el.appendChild(cover);
    }

    const text = document.createElement("div");
    text.className = "mmm-spotify-sonos__now-playing-panel-text";

    const title = document.createElement("div");
    title.className = "mmm-spotify-sonos__now-playing-panel-title";
    title.innerText = track.name;
    text.appendChild(title);

    const artist = document.createElement("div");
    artist.className = "mmm-spotify-sonos__now-playing-panel-artist";
    artist.innerText = track.artist || "";
    text.appendChild(artist);

    el.appendChild(text);
  },

  // Position only arrives on a poll tick, so between ticks this estimates how
  // far playback has moved on using elapsed wall-clock time since the last
  // one arrived — paused playback (or no baseline yet) just holds position.
  _currentElapsed() {
    const { position, duration } = this.progress || {};
    if (position === null || duration === null) return 0;
    if (!this.playback?.isPlaying || !this._progressReceivedAt) return position;
    const sinceReceived = (Date.now() - this._progressReceivedAt) / 1000;
    return Math.min(duration, position + sinceReceived);
  },

  _formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  },

  _renderProgress() {
    if (!this._progressEl) return;
    const el = this._progressEl;
    const { position, duration } = this.progress || {};
    if (position === null || !duration) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = "";

    const elapsed = this._currentElapsed();
    const pct = Math.min(100, Math.max(0, (elapsed / duration) * 100));

    const track = document.createElement("div");
    track.className = "mmm-spotify-sonos__progress-track";
    const fill = document.createElement("div");
    fill.className = "mmm-spotify-sonos__progress-fill";
    fill.style.width = `${pct}%`;
    track.appendChild(fill);
    el.appendChild(track);

    const times = document.createElement("div");
    times.className = "mmm-spotify-sonos__progress-times";
    const elapsedLabel = document.createElement("span");
    elapsedLabel.innerText = this._formatTime(elapsed);
    times.appendChild(elapsedLabel);
    const durationLabel = document.createElement("span");
    durationLabel.innerText = this._formatTime(duration);
    times.appendChild(durationLabel);
    el.appendChild(times);
  },

  _renderNowPlayingControls() {
    if (!this._nowPlayingControlsEl) return;
    const controls = this._nowPlayingControlsEl;
    controls.innerHTML = "";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "mmm-spotify-sonos__control-btn";
    prevBtn.innerText = "⏮";
    prevBtn.addEventListener("click", () => {
      if (!this.activeDeviceId) return;
      this.sendSocketNotification("SPOTIFY_SKIP", { deviceId: this.activeDeviceId, direction: "previous" });
    });
    controls.appendChild(prevBtn);

    const isPlaying = this.playback.isPlaying;
    const playPauseBtn = document.createElement("button");
    playPauseBtn.type = "button";
    playPauseBtn.className = "mmm-spotify-sonos__control-btn mmm-spotify-sonos__control-btn--primary";
    playPauseBtn.innerText = isPlaying ? "⏸" : "▶";
    playPauseBtn.addEventListener("click", () => {
      if (!this.activeDeviceId) return;
      // Optimistic flip — SPOTIFY_PLAYBACK_STATE will correct it on the next poll tick.
      this.playback = { ...this.playback, isPlaying: !isPlaying };
      this.sendSocketNotification("SPOTIFY_PLAYPAUSE", { deviceId: this.activeDeviceId, isPlaying });
      this._renderNowPlayingControls();
    });
    controls.appendChild(playPauseBtn);

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "mmm-spotify-sonos__control-btn";
    nextBtn.innerText = "⏭";
    nextBtn.addEventListener("click", () => {
      if (!this.activeDeviceId) return;
      this.sendSocketNotification("SPOTIFY_SKIP", { deviceId: this.activeDeviceId, direction: "next" });
    });
    controls.appendChild(nextBtn);
  },

  _buildSearchBox() {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "mmm-spotify-sonos__search-input";
    input.placeholder = this.translate("SEARCH_PLACEHOLDER");
    input.addEventListener("input", () => this._debouncedSearch(input.value));
    // These fire regardless of virtualKeyboardCommand being configured — the
    // backend is what decides whether a keyboard actually exists to show.
    input.addEventListener("focus", () => this.sendSocketNotification("SPOTIFY_KEYBOARD_SHOW"));
    input.addEventListener("blur", () => this.sendSocketNotification("SPOTIFY_KEYBOARD_HIDE"));
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
    playBtn.className = "mmm-spotify-sonos__result-action mmm-spotify-sonos__result-action--primary";
    playBtn.innerText = this.translate("PLAY_NOW");
    playBtn.addEventListener("click", () => this._handlePlayNow(item, playBtn));
    actions.appendChild(playBtn);

    // Playlists aren't offered an "Add to queue" button in v1 — queueing a whole
    // playlist at once is a different interaction than track-by-track queueing and
    // wasn't part of this pivot's scope (Sonos's own queue() does support playlist
    // URIs technically).
    if (item.type === "track") {
      const queueBtn = document.createElement("button");
      queueBtn.type = "button";
      queueBtn.className = "mmm-spotify-sonos__result-action";
      queueBtn.innerText = this.translate("ADD_TO_QUEUE");
      queueBtn.addEventListener("click", () => this._handleQueueAdd(item, queueBtn));
      actions.appendChild(queueBtn);
    }

    tile.appendChild(actions);
    return tile;
  },

  _hasPlaybackTarget() {
    return Boolean(this.activeDeviceId);
  },

  _handlePlayNow(item, btn) {
    if (!this._hasPlaybackTarget()) {
      // Just unhiding the list isn't enough — it lives at the top of the overlay,
      // while the result you tapped can be scrolled far below it, so the list can
      // pop open completely out of view and look like nothing happened at all.
      this.lastError = this.translate("NO_ACTIVE_SPEAKER");
      this._renderError();
      if (this._deviceListEl) {
        this._devicePickerExpanded = true;
        this._deviceListEl.hidden = false;
        this._deviceListEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      return;
    }
    // Starting a playlist can take several seconds (Sonos has to expand it
    // before playback actually begins) with nothing else on screen to show
    // for it, so mark the button busy immediately rather than leave it
    // looking like the tap did nothing.
    this._setButtonBusy(btn, this.translate("PLAY_NOW_PENDING"));
    this.sendSocketNotification("SPOTIFY_PLAY_NOW", { deviceId: this.activeDeviceId, uri: item.uri });
  },

  _handleQueueAdd(item, btn) {
    if (!this._hasPlaybackTarget()) {
      this.lastError = this.translate("NO_ACTIVE_SPEAKER");
      this._renderError();
      return;
    }
    this._setButtonBusy(btn, this.translate("ADD_TO_QUEUE_PENDING"));
    this.sendSocketNotification("SPOTIFY_QUEUE_ADD", { uri: item.uri, deviceId: this.activeDeviceId });
  },

  _setButtonBusy(btn, pendingLabel) {
    if (!btn || btn.disabled) return;
    // Stashed lazily so this works regardless of which translation the button
    // was originally built with.
    btn.dataset.defaultLabel = btn.innerText;
    btn.disabled = true;
    btn.classList.add("mmm-spotify-sonos__result-action--busy");
    btn.innerText = pendingLabel;
  },

  // Restores every result button this session left mid-action — at most one
  // in practice, but harmless to sweep all of them. A fresh search rebuilds
  // _resultsEl from scratch anyway, so there's nothing stale to find once
  // that happens.
  _clearBusyButtons() {
    if (!this._resultsEl) return;
    this._resultsEl.querySelectorAll(".mmm-spotify-sonos__result-action--busy").forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove("mmm-spotify-sonos__result-action--busy");
      if (btn.dataset.defaultLabel) btn.innerText = btn.dataset.defaultLabel;
    });
  },

  // Marks the device picker busy right after a speaker is picked — disables
  // further picks and swaps the toggle's label to "Moving music…" until
  // SPOTIFY_ACTION_DONE confirms the switch (transfer or not) is finished.
  // Mutates the DOM directly rather than re-rendering, since a genuine
  // transfer suppresses the poll updates that would otherwise rebuild this
  // (see node_helper's _transferInProgress) — nothing else touches this
  // picker again until the switch is done.
  _setSpeakerSwitching() {
    if (!this._devicePickerEl) return;
    const toggle = this._devicePickerEl.querySelector(".mmm-spotify-sonos__device-picker-toggle");
    if (toggle) {
      toggle.dataset.defaultLabel = toggle.innerText;
      toggle.disabled = true;
      toggle.innerText = this.translate("SWITCHING_SPEAKER");
    }
    if (this._deviceListEl) {
      this._deviceListEl.hidden = true;
      this._deviceListEl.querySelectorAll(".mmm-spotify-sonos__device-picker-item").forEach((item) => {
        item.disabled = true;
      });
    }
  },

  _clearSpeakerSwitching() {
    if (!this._devicePickerEl) return;
    const toggle = this._devicePickerEl.querySelector(".mmm-spotify-sonos__device-picker-toggle");
    if (toggle && toggle.dataset.defaultLabel) {
      toggle.disabled = false;
      toggle.innerText = toggle.dataset.defaultLabel;
    }
  },

  _renderResults() {
    if (!this._resultsEl) return;
    const section = this._resultsEl;
    section.innerHTML = "";

    const tracksHeading = document.createElement("h3");
    tracksHeading.className = "mmm-spotify-sonos__section-heading";
    tracksHeading.innerText = this.translate("TRACKS");
    section.appendChild(tracksHeading);
    const tracksRow = document.createElement("div");
    tracksRow.className = "mmm-spotify-sonos__results-row";
    this.searchResults.tracks.forEach((track) => tracksRow.appendChild(this._buildResultTile(track)));
    section.appendChild(tracksRow);

    const playlistsHeading = document.createElement("h3");
    playlistsHeading.className = "mmm-spotify-sonos__section-heading";
    playlistsHeading.innerText = this.translate("PLAYLISTS");
    section.appendChild(playlistsHeading);
    const playlistsRow = document.createElement("div");
    playlistsRow.className = "mmm-spotify-sonos__results-row";
    this.searchResults.playlists.forEach((playlist) => playlistsRow.appendChild(this._buildResultTile(playlist)));
    section.appendChild(playlistsRow);
  },

  _renderQueue() {
    if (!this._queueEl) return;
    const section = this._queueEl;
    section.innerHTML = "";

    const items = this.queue?.queue || [];
    section.hidden = items.length === 0;
    if (items.length === 0) return;

    // A queue built from a big playlist can run to dozens of items — cap what's
    // shown so it doesn't push search results off screen, with a way to see
    // the rest on demand. 0/falsy `maxQueueItemsShown` means "no limit".
    const limit = this.config.maxQueueItemsShown;
    const canCollapse = Boolean(limit) && items.length > limit;
    const showingAll = this._queueExpanded || !canCollapse;
    const visibleItems = showingAll ? items : items.slice(0, limit);
    const collapse = () => {
      this._queueExpanded = false;
      this._renderQueue();
    };

    const headingRow = document.createElement("div");
    headingRow.className = "mmm-spotify-sonos__queue-heading-row";

    const heading = document.createElement("h3");
    heading.className = "mmm-spotify-sonos__section-heading";
    heading.innerText = this.translate("UP_NEXT");
    headingRow.appendChild(heading);

    // A long expanded list can run well past a screen's height — a minimize
    // control only at the bottom would mean scrolling all the way back down
    // just to collapse it again, so this mirrors it up here too.
    if (canCollapse && this._queueExpanded) {
      const minimizeBtn = document.createElement("button");
      minimizeBtn.type = "button";
      minimizeBtn.className = "mmm-spotify-sonos__queue-minimize-top";
      minimizeBtn.innerText = "▲";
      minimizeBtn.setAttribute("aria-label", this.translate("SHOW_LESS"));
      minimizeBtn.addEventListener("click", collapse);
      headingRow.appendChild(minimizeBtn);
    }

    section.appendChild(headingRow);

    const list = document.createElement("div");
    list.className = "mmm-spotify-sonos__queue-list";
    visibleItems.forEach((item) => {
      const row = document.createElement("div");
      row.className = "mmm-spotify-sonos__queue-row";

      if (item.imageUrl) {
        const thumb = document.createElement("img");
        thumb.className = "mmm-spotify-sonos__queue-thumb";
        thumb.src = item.imageUrl;
        row.appendChild(thumb);
      }

      const text = document.createElement("div");
      text.className = "mmm-spotify-sonos__queue-text";

      const name = document.createElement("span");
      name.className = "mmm-spotify-sonos__queue-name";
      name.innerText = item.name || "";
      text.appendChild(name);

      const artist = document.createElement("span");
      artist.className = "mmm-spotify-sonos__queue-artist";
      artist.innerText = item.artist || "";
      text.appendChild(artist);

      row.appendChild(text);
      list.appendChild(row);
    });
    section.appendChild(list);

    if (canCollapse) {
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "mmm-spotify-sonos__queue-show-more";
      if (this._queueExpanded) {
        toggleBtn.innerText = this.translate("SHOW_LESS");
        toggleBtn.addEventListener("click", collapse);
      } else {
        toggleBtn.innerText = this.translate("SHOW_MORE", { count: items.length - limit });
        toggleBtn.addEventListener("click", () => {
          this._queueExpanded = true;
          this._renderQueue();
        });
      }
      section.appendChild(toggleBtn);
    }
  },

  _renderError() {
    if (!this._errorEl) return;
    this._errorEl.innerText = this.lastError || "";
    this._errorEl.hidden = !this.lastError;
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
