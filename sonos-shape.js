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

// getQueue() always returns the WHOLE Sonos queue from position 1, including
// tracks already played — it never shrinks or reorders as playback advances.
// Left unfiltered, "Up Next" would keep showing already-skipped-past tracks
// forever instead of updating. currentTrack().queuePosition is the 1-indexed
// position of the track currently playing (rawQueueItems[0] is position 1),
// so the items strictly after it — rawQueueItems.slice(queuePosition) — are
// what's actually still ahead. A missing/unparseable queuePosition (e.g.
// nothing is playing from the queue yet) falls back to the full queue rather
// than hiding it.
function upcomingQueueItems(rawQueueItems, queuePosition) {
  const items = rawQueueItems || [];
  const position = Number.isInteger(queuePosition) ? queuePosition : 0;
  return items.slice(position);
}

module.exports = { shapeZones, shapeTrack, isSpotifyTrack, upcomingQueueItems };
