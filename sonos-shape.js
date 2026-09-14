"use strict";

function shapeZones(rawGroups) {
  return (rawGroups || []).map((group) => ({
    id: group.ID,
    name: group.Name,
    coordinatorHost: group.CoordinatorDevice().host
  }));
}

function shapeTrack(rawTrack) {
  return {
    name: rawTrack?.title || "",
    artist: rawTrack?.artist || "",
    imageUrl: rawTrack?.albumArtURI || rawTrack?.albumArtURL || null
  };
}

function isSpotifyTrack(rawTrack) {
  return Boolean(rawTrack?.uri && rawTrack.uri.toLowerCase().includes("spotify"));
}

module.exports = { shapeZones, shapeTrack, isSpotifyTrack };
