"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { shapeSearchResults, shapeOwnPlaylists, mergePlaylists } = require("../spotify-shape");

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

