"use strict";

function getRetryDelayMs(headers) {
  const raw = headers?.get ? headers.get("retry-after") : null;
  const seconds = parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return 1000;
  return seconds * 1000;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function spotifyRequest(fetchImpl, path, options, { getAccessToken, onUnauthorized, sleepImpl = defaultSleep }, retried = false) {
  const accessToken = await getAccessToken();
  const response = await fetchImpl(`https://api.spotify.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  if (!retried && response.status === 429) {
    await sleepImpl(getRetryDelayMs(response.headers));
    return spotifyRequest(fetchImpl, path, options, { getAccessToken, onUnauthorized, sleepImpl }, true);
  }

  if (!retried && response.status === 401) {
    await onUnauthorized();
    return spotifyRequest(fetchImpl, path, options, { getAccessToken, onUnauthorized, sleepImpl }, true);
  }

  return response;
}

module.exports = { getRetryDelayMs, spotifyRequest };
