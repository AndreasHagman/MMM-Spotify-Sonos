"use strict";

const NodeHelper = require("node_helper");
const Log = require("logger");

module.exports = NodeHelper.create({
  start() {
    Log.log("[MMM-Spotify-Sonos] node_helper started");
  }
});
