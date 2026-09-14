"use strict";

// A group whose Coordinator UUID doesn't match any known member (a speaker that
// just dropped off the network, a regroup mid-flight) has no usable
// CoordinatorDevice — such a group is skipped rather than throwing, since there's
// no host to send commands to anyway.
function shapeZones(rawGroups) {
  return (rawGroups || [])
    .map((group) => {
      if (typeof group.CoordinatorDevice !== "function") return null;
      try {
        return { id: group.ID, name: group.Name, coordinatorHost: group.CoordinatorDevice().host };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function shapeTrack(rawTrack) {
  return {
    name: rawTrack?.title || "",
    artist: rawTrack?.artist || "",
    // albumArtURL is the absolute URL the library computes (http://<zone-ip>:1400/...);
    // albumArtURI is Sonos's raw, host-less relative path, which a browser would
    // resolve against MagicMirror's own origin and 404 on. Prefer the usable one.
    imageUrl: rawTrack?.albumArtURL || rawTrack?.albumArtURI || null
  };
}

function isSpotifyTrack(rawTrack) {
  return Boolean(rawTrack?.uri && rawTrack.uri.toLowerCase().includes("spotify"));
}

module.exports = { shapeZones, shapeTrack, isSpotifyTrack };
