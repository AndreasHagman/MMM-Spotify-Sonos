"use strict";

function joinArtists(artists) {
  return (artists || []).map((artist) => artist.name).join(", ");
}

function shapeSearchResults(apiResponse) {
  const tracks = (apiResponse?.tracks?.items || []).filter(Boolean).map((track) => ({
    id: track.id,
    uri: track.uri,
    name: track.name,
    artist: joinArtists(track.artists),
    imageUrl: track.album?.images?.[0]?.url || null,
    type: "track"
  }));

  const playlists = (apiResponse?.playlists?.items || []).filter(Boolean).map((playlist) => ({
    id: playlist.id,
    uri: playlist.uri,
    name: playlist.name,
    owner: playlist.owner?.display_name || "",
    imageUrl: playlist.images?.[0]?.url || null,
    type: "playlist"
  }));

  return { tracks, playlists };
}

function shapeOwnPlaylists(apiResponse, query) {
  const needle = query.toLowerCase();
  return (apiResponse?.items || [])
    .filter(Boolean)
    .filter((playlist) => (playlist.name || "").toLowerCase().includes(needle))
    .map((playlist) => ({
      id: playlist.id,
      uri: playlist.uri,
      name: playlist.name,
      owner: playlist.owner?.display_name || "",
      imageUrl: playlist.images?.[0]?.url || null,
      type: "playlist",
      own: true
    }));
}

function mergePlaylists(ownMatches, searchMatches, limit) {
  const seen = new Set();
  const merged = [];
  for (const playlist of [...ownMatches, ...searchMatches]) {
    if (seen.has(playlist.id)) continue;
    seen.add(playlist.id);
    merged.push(playlist);
    if (merged.length >= limit) break;
  }
  return merged;
}

module.exports = {
  shapeSearchResults,
  shapeOwnPlaylists,
  mergePlaylists
};
