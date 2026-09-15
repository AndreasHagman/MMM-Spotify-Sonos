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

// currentTrack() already computes position/duration (seconds, from Sonos's
// RelTime/TrackDuration) on the currently-playing track — a separate shaper
// (rather than folding this into shapeTrack) because it's a "now playing
// state" concept, not a track one: a queue item run through shapeTrack has
// no meaningful position, having not played yet.
function shapeProgress(rawTrack) {
  const position = typeof rawTrack?.position === "number" && Number.isFinite(rawTrack.position) ? rawTrack.position : null;
  const duration = typeof rawTrack?.duration === "number" && Number.isFinite(rawTrack.duration) ? rawTrack.duration : null;
  return { position, duration };
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

// Sonos's own URIs (from currentTrack()/getQueue(), e.g.
// "x-sonos-spotify:spotify%3atrack%3aXYZ?sid=9&flags=...") aren't accepted by
// sonos.queue() the way a plain "spotify:track:XYZ" URI is — the library's
// GenerateMetadata() only recognizes URIs starting with "spotify:", so moving
// a track onto a different zone (re-queuing it there) needs this reversed
// back into the plain form first. Confirmed against real Sonos output.
function toSpotifyUri(rawUri) {
  if (typeof rawUri !== "string") return null;
  const match = rawUri.match(/^x-sonos-spotify:([^?]+)/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

// What should be (re-)queued on a different zone when moving playback there:
// the current track and everything still ahead of it — not the whole queue
// from track 1, which would replay what's already been heard. Falls back to
// just the current track (from its own URI) if the queue can't be resolved,
// so a transfer still does something rather than nothing.
function transferQueueUris(rawQueueItems, queuePosition, currentTrackUri) {
  const items = rawQueueItems || [];
  if (Number.isInteger(queuePosition) && queuePosition >= 1) {
    const fromCurrent = items
      .slice(queuePosition - 1)
      .map((item) => toSpotifyUri(item?.uri))
      .filter(Boolean);
    if (fromCurrent.length > 0) return fromCurrent;
  }
  const fallback = toSpotifyUri(currentTrackUri);
  return fallback ? [fallback] : [];
}

module.exports = { shapeZones, shapeTrack, isSpotifyTrack, upcomingQueueItems, shapeProgress, toSpotifyUri, transferQueueUris };
