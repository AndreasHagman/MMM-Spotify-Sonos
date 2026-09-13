"use strict";

const { describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");

const { getRetryDelayMs, spotifyRequest } = require("../spotify-request");

function fakeHeaders(map) {
  return { get: (name) => map[name.toLowerCase()] ?? null };
}

describe("getRetryDelayMs()", () => {
  it("reads the Retry-After header in seconds and converts to ms", () => {
    assert.strictEqual(getRetryDelayMs(fakeHeaders({ "retry-after": "2" })), 2000);
  });

  it("defaults to 1000ms when the header is missing or not a positive number", () => {
    assert.strictEqual(getRetryDelayMs(fakeHeaders({})), 1000);
    assert.strictEqual(getRetryDelayMs(fakeHeaders({ "retry-after": "0" })), 1000);
    assert.strictEqual(getRetryDelayMs(fakeHeaders({ "retry-after": "nope" })), 1000);
  });
});

describe("spotifyRequest()", () => {
  it("attaches the bearer token from getAccessToken and returns the response on success", async () => {
    const fakeFetch = mock.fn(async () => ({ ok: true, status: 200, headers: fakeHeaders({}) }));
    const response = await spotifyRequest(fakeFetch, "/v1/me", {}, { getAccessToken: async () => "TOKEN123", onUnauthorized: async () => {} });
    assert.strictEqual(response.status, 200);
    const [url, options] = fakeFetch.mock.calls[0].arguments;
    assert.strictEqual(url, "https://api.spotify.com/v1/me");
    assert.strictEqual(options.headers.Authorization, "Bearer TOKEN123");
  });

  it("retries once after a 429, waiting the Retry-After delay via the injected sleepImpl", async () => {
    let call = 0;
    const fakeFetch = mock.fn(async () => {
      call += 1;
      if (call === 1) return { ok: false, status: 429, headers: fakeHeaders({ "retry-after": "3" }) };
      return { ok: true, status: 200, headers: fakeHeaders({}) };
    });
    const sleepCalls = [];
    const response = await spotifyRequest(
      fakeFetch,
      "/v1/search",
      {},
      {
        getAccessToken: async () => "TOKEN",
        onUnauthorized: async () => {},
        sleepImpl: async (ms) => sleepCalls.push(ms)
      }
    );
    assert.strictEqual(response.status, 200);
    assert.strictEqual(fakeFetch.mock.calls.length, 2);
    assert.deepStrictEqual(sleepCalls, [3000]);
  });

  it("refreshes the token once after a 401 and retries the request", async () => {
    let call = 0;
    const fakeFetch = mock.fn(async () => {
      call += 1;
      if (call === 1) return { ok: false, status: 401, headers: fakeHeaders({}) };
      return { ok: true, status: 200, headers: fakeHeaders({}) };
    });
    const onUnauthorized = mock.fn(async () => {});
    const response = await spotifyRequest(fakeFetch, "/v1/me", {}, { getAccessToken: async () => "TOKEN", onUnauthorized });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(onUnauthorized.mock.calls.length, 1);
    assert.strictEqual(fakeFetch.mock.calls.length, 2);
  });

  it("does not retry a second time if the retried request also fails", async () => {
    const fakeFetch = mock.fn(async () => ({ ok: false, status: 401, headers: fakeHeaders({}) }));
    const response = await spotifyRequest(fakeFetch, "/v1/me", {}, { getAccessToken: async () => "TOKEN", onUnauthorized: async () => {} });
    assert.strictEqual(response.status, 401);
    assert.strictEqual(fakeFetch.mock.calls.length, 2);
  });

  it("passes through method/body options untouched", async () => {
    const fakeFetch = mock.fn(async () => ({ ok: true, status: 204, headers: fakeHeaders({}) }));
    await spotifyRequest(fakeFetch, "/v1/me/player/next", { method: "POST" }, { getAccessToken: async () => "TOKEN", onUnauthorized: async () => {} });
    const [, options] = fakeFetch.mock.calls[0].arguments;
    assert.strictEqual(options.method, "POST");
  });
});
