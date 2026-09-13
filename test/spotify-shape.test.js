"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { shapeSearchResults, shapeOwnPlaylists, mergePlaylists, shapeDevices, shapeQueueResponse, shapePlaybackState } = require("../spotify-shape");

describe("shapeSearchResults()", () => {
  it("shapes tracks and playlists from a combined search response", () => {
    const result = shapeSearchResults({
      tracks: {
        items: [
          {
            id: "t1",
            uri: "spotify:track:t1",
            name: "Song One",
            artists: [{ name: "Artist A" }, { name: "Artist B" }],
            album: { images: [{ url: "http://img/track.jpg" }] }
          }
        ]
      },
      playlists: {
        items: [
          {
            id: "p1",
            uri: "spotify:playlist:p1",
            name: "Playlist One",
            owner: { display_name: "Some User" },
            images: [{ url: "http://img/playlist.jpg" }]
          }
        ]
      }
    });

    assert.deepStrictEqual(result.tracks, [
      {
        id: "t1",
        uri: "spotify:track:t1",
        name: "Song One",
        artist: "Artist A, Artist B",
        imageUrl: "http://img/track.jpg",
        type: "track"
      }
    ]);
    assert.deepStrictEqual(result.playlists, [
      {
        id: "p1",
        uri: "spotify:playlist:p1",
        name: "Playlist One",
        owner: "Some User",
        imageUrl: "http://img/playlist.jpg",
        type: "playlist"
      }
    ]);
  });

  it("skips null playlist slots and missing images without throwing", () => {
    const result = shapeSearchResults({
      tracks: { items: [{ id: "t1", uri: "u", name: "n", artists: [], album: {} }] },
      playlists: { items: [null, { id: "p1", uri: "u2", name: "n2", owner: {}, images: [] }] }
    });
    assert.strictEqual(result.tracks[0].imageUrl, null);
    assert.strictEqual(result.tracks[0].artist, "");
    assert.strictEqual(result.playlists.length, 1);
    assert.strictEqual(result.playlists[0].imageUrl, null);
    assert.strictEqual(result.playlists[0].owner, "");
  });

  it("returns empty arrays for an empty/undefined response", () => {
    assert.deepStrictEqual(shapeSearchResults({}), { tracks: [], playlists: [] });
    assert.deepStrictEqual(shapeSearchResults(undefined), { tracks: [], playlists: [] });
  });
});

describe("shapeOwnPlaylists()", () => {
  const apiResponse = {
    items: [
      { id: "p1", uri: "u1", name: "Friday Night Mix", owner: { display_name: "Me" }, images: [] },
      { id: "p2", uri: "u2", name: "Workout", owner: { display_name: "Me" }, images: [] }
    ]
  };

  it("filters by case-insensitive name match and marks results as own", () => {
    const result = shapeOwnPlaylists(apiResponse, "friday");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, "p1");
    assert.strictEqual(result[0].own, true);
  });

  it("returns an empty array when nothing matches", () => {
    assert.deepStrictEqual(shapeOwnPlaylists(apiResponse, "zzz"), []);
  });
});

describe("mergePlaylists()", () => {
  it("puts own matches first and dedupes by id", () => {
    const own = [{ id: "p1", name: "Own One" }];
    const searched = [
      { id: "p1", name: "Duplicate of own" },
      { id: "p2", name: "Public playlist" }
    ];
    const merged = mergePlaylists(own, searched, 10);
    assert.deepStrictEqual(
      merged.map((p) => p.id),
      ["p1", "p2"]
    );
    assert.strictEqual(merged[0].name, "Own One");
  });

  it("truncates to the given limit", () => {
    const own = [{ id: "p1" }, { id: "p2" }];
    const searched = [{ id: "p3" }, { id: "p4" }];
    const merged = mergePlaylists(own, searched, 3);
    assert.deepStrictEqual(
      merged.map((p) => p.id),
      ["p1", "p2", "p3"]
    );
  });
});

describe("shapeDevices()", () => {
  it("shapes the device list, defaulting missing fields", () => {
    const result = shapeDevices({
      devices: [
        { id: "d1", name: "Living Room", type: "Speaker", is_active: true, volume_percent: 40 },
        { id: "d2", name: "Kitchen", type: "Speaker", is_active: false }
      ]
    });
    assert.deepStrictEqual(result, [
      { id: "d1", name: "Living Room", type: "Speaker", isActive: true, volumePercent: 40 },
      { id: "d2", name: "Kitchen", type: "Speaker", isActive: false, volumePercent: null }
    ]);
  });

  it("returns an empty array when there are no devices", () => {
    assert.deepStrictEqual(shapeDevices({ devices: [] }), []);
    assert.deepStrictEqual(shapeDevices({}), []);
  });
});

describe("shapeQueueResponse()", () => {
  it("shapes the currently playing track and the upcoming queue", () => {
    const result = shapeQueueResponse({
      currently_playing: { id: "t1", uri: "u1", name: "Now Playing", artists: [{ name: "A" }] },
      queue: [{ id: "t2", uri: "u2", name: "Next Up", artists: [{ name: "B" }] }]
    });
    assert.deepStrictEqual(result.currentlyPlaying, {
      id: "t1",
      uri: "u1",
      name: "Now Playing",
      artist: "A",
      imageUrl: null
    });
    assert.deepStrictEqual(result.queue, [{ id: "t2", uri: "u2", name: "Next Up", artist: "B" }]);
  });

  it("handles nothing currently playing and an empty queue", () => {
    assert.deepStrictEqual(shapeQueueResponse({ currently_playing: null, queue: [] }), {
      currentlyPlaying: null,
      queue: []
    });
    assert.deepStrictEqual(shapeQueueResponse({}), { currentlyPlaying: null, queue: [] });
  });
});

describe("shapePlaybackState()", () => {
  it("shapes an active playback response", () => {
    const result = shapePlaybackState({
      is_playing: true,
      device: { id: "d1", name: "Living Room", type: "Speaker" },
      item: {
        id: "t1",
        uri: "u1",
        name: "Song",
        artists: [{ name: "A" }],
        album: { images: [{ url: "http://img/x.jpg" }] }
      }
    });
    assert.deepStrictEqual(result, {
      isPlaying: true,
      device: { id: "d1", name: "Living Room", type: "Speaker" },
      track: { id: "t1", uri: "u1", name: "Song", artist: "A", imageUrl: "http://img/x.jpg" }
    });
  });

  it("treats a missing item as nothing playing", () => {
    assert.deepStrictEqual(shapePlaybackState({}), { isPlaying: false, device: null, track: null });
    assert.deepStrictEqual(shapePlaybackState(null), { isPlaying: false, device: null, track: null });
  });
});
