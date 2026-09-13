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

function shapeDevices(apiResponse) {
  return (apiResponse?.devices || []).map((device) => ({
    id: device.id,
    name: device.name,
    type: device.type,
    isActive: !!device.is_active,
    volumePercent: device.volume_percent ?? null
  }));
}

function shapeTrackLike(item) {
  return {
    id: item.id,
    uri: item.uri,
    name: item.name,
    artist: joinArtists(item.artists)
  };
}

function shapeQueueResponse(apiResponse) {
  const current = apiResponse?.currently_playing;
  return {
    currentlyPlaying: current ? { ...shapeTrackLike(current), imageUrl: current.album?.images?.[0]?.url || null } : null,
    queue: (apiResponse?.queue || []).map(shapeTrackLike)
  };
}

function shapePlaybackState(apiResponse) {
  if (!apiResponse || !apiResponse.item) {
    return { isPlaying: false, device: null, track: null };
  }
  return {
    isPlaying: !!apiResponse.is_playing,
    device: apiResponse.device ? { id: apiResponse.device.id, name: apiResponse.device.name, type: apiResponse.device.type } : null,
    track: {
      id: apiResponse.item.id,
      uri: apiResponse.item.uri,
      name: apiResponse.item.name,
      artist: joinArtists(apiResponse.item.artists),
      imageUrl: apiResponse.item.album?.images?.[0]?.url || null
    }
  };
}

module.exports = {
  shapeSearchResults,
  shapeOwnPlaylists,
  mergePlaylists,
  shapeDevices,
  shapeQueueResponse,
  shapePlaybackState
};
