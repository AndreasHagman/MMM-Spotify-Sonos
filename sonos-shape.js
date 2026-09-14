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
// what's actually still ahead.
//
// A queuePosition that isn't a valid 1-based index into the queue (0,
// negative, or missing/unparseable) means the current track ISN'T actually
// playing from the tracked queue at all — confirmed live: once an explicit
// queue plays out to its end, Sonos/Spotify can auto-continue into a
// recommendation ("x-sonos-vli:" autoplay) with queuePosition 0, while the
// old queue's now-fully-played tracks are still sitting in getQueue()'s
// result. None of them are genuinely "up next" at that point, so this
// returns an empty list rather than the stale queue.
function upcomingQueueItems(rawQueueItems, queuePosition) {
  const items = rawQueueItems || [];
  if (!Number.isInteger(queuePosition) || queuePosition < 1) return [];
  return items.slice(queuePosition);
}

module.exports = { shapeZones, shapeTrack, isSpotifyTrack, upcomingQueueItems };
