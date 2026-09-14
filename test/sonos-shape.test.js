"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { shapeZones, shapeTrack, isSpotifyTrack, upcomingQueueItems } = require("../sonos-shape");

describe("shapeZones()", () => {
  it("shapes a list of raw Sonos groups into id/name/coordinatorHost", () => {
    const rawGroups = [
      { ID: "RINCON_A:1", Name: "Kjøkkenhøyttaler + 1", CoordinatorDevice: () => ({ host: "10.0.0.17" }) },
      { ID: "RINCON_B:2", Name: "Stue", CoordinatorDevice: () => ({ host: "10.0.0.34" }) }
    ];
    assert.deepStrictEqual(shapeZones(rawGroups), [
      { id: "RINCON_A:1", name: "Kjøkkenhøyttaler + 1", coordinatorHost: "10.0.0.17" },
      { id: "RINCON_B:2", name: "Stue", coordinatorHost: "10.0.0.34" }
    ]);
  });

  it("returns an empty array for an empty group list", () => {
    assert.deepStrictEqual(shapeZones([]), []);
  });

  it("skips a group whose coordinator can't be resolved, keeping the resolvable ones", () => {
    const rawGroups = [
      { ID: "RINCON_GONE:9", Name: "Ghost zone" },
      { ID: "RINCON_B:2", Name: "Stue", CoordinatorDevice: () => ({ host: "10.0.0.34" }) }
    ];
    assert.deepStrictEqual(shapeZones(rawGroups), [{ id: "RINCON_B:2", name: "Stue", coordinatorHost: "10.0.0.34" }]);
  });
});

describe("shapeTrack()", () => {
  it("shapes a raw Sonos track into name/artist/imageUrl", () => {
    const raw = {
      title: "Bohemian Rhapsody",
      artist: "Queen",
      album: "A Night At The Opera",
      albumArtURI: "https://i.scdn.co/image/xyz",
      uri: "x-sonos-spotify:spotify%3atrack%3aabc?sid=9&flags=8232&sn=2"
    };
    assert.deepStrictEqual(shapeTrack(raw), {
      name: "Bohemian Rhapsody",
      artist: "Queen",
      imageUrl: "https://i.scdn.co/image/xyz"
    });
  });

  it("defaults missing fields rather than throwing", () => {
    assert.deepStrictEqual(shapeTrack({}), { name: "", artist: "", imageUrl: null });
  });

  it("prefers the absolute albumArtURL over the relative albumArtURI (Sonos returns both, only the URL one is directly usable)", () => {
    const raw = {
      title: "Song",
      artist: "Artist",
      albumArtURI: "/getaa?s=1&u=x-sonos-spotify%3aspotify%253atrack%253aabc",
      albumArtURL: "http://10.0.0.17:1400/getaa?s=1&u=x-sonos-spotify%3aspotify%253atrack%253aabc"
    };
    assert.strictEqual(shapeTrack(raw).imageUrl, "http://10.0.0.17:1400/getaa?s=1&u=x-sonos-spotify%3aspotify%253atrack%253aabc");
  });
});

describe("upcomingQueueItems()", () => {
  const items = [{ title: "Hideaway" }, { title: "Dancing Queen" }, { title: "Sandstorm" }];

  it("drops tracks up to and including the current queue position (1-indexed)", () => {
    assert.deepStrictEqual(upcomingQueueItems(items, 1), [{ title: "Dancing Queen" }, { title: "Sandstorm" }]);
  });

  it("returns an empty list once the current track is the last one in the queue", () => {
    assert.deepStrictEqual(upcomingQueueItems(items, 3), []);
  });

  it("returns an empty list when queuePosition is missing/unparseable or not a valid 1-based index", () => {
    // Confirmed live: once the explicit queue plays out, Sonos/Spotify can auto-continue
    // into a recommendation outside the queue, reporting queuePosition 0 while getQueue()
    // still lists the now-fully-played tracks — none of them are genuinely "up next".
    assert.deepStrictEqual(upcomingQueueItems(items, 0), []);
    assert.deepStrictEqual(upcomingQueueItems(items, NaN), []);
    assert.deepStrictEqual(upcomingQueueItems(items, undefined), []);
    assert.deepStrictEqual(upcomingQueueItems(items, -1), []);
  });

  it("returns an empty array for a missing/empty queue", () => {
    assert.deepStrictEqual(upcomingQueueItems(null, 1), []);
    assert.deepStrictEqual(upcomingQueueItems([], 1), []);
  });
});

describe("isSpotifyTrack()", () => {
  it("returns true when the track's uri contains the Spotify scheme", () => {
    assert.strictEqual(isSpotifyTrack({ uri: "x-sonos-spotify:spotify%3atrack%3aabc?sid=9" }), true);
  });

  it("returns false for non-Spotify sources (e.g. radio)", () => {
    assert.strictEqual(isSpotifyTrack({ uri: "x-sonosapi-stream:s25111?sid=254" }), false);
  });

  it("returns false for a missing or empty track", () => {
    assert.strictEqual(isSpotifyTrack(null), false);
    assert.strictEqual(isSpotifyTrack(undefined), false);
    assert.strictEqual(isSpotifyTrack({}), false);
  });
});
