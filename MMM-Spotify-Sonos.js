"use strict";

Module.register("MMM-Spotify-Sonos", {
  defaults: {},

  start() {
    Log.log("[MMM-Spotify-Sonos] frontend started");
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-spotify-sonos";
    return wrapper;
  }
});
