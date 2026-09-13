"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { generateCodeVerifier, generateCodeChallenge, generateState, isTokenExpired, readTokenFile, writeTokenFile, deleteTokenFile, buildAuthorizeUrl, exchangeCodeForTokens, refreshAccessToken, startCallbackServer } = require("../spotify-auth");

describe("generateCodeVerifier()", () => {
  it("returns a URL-safe string with no padding characters", () => {
    const verifier = generateCodeVerifier();
    assert.match(verifier, /^[A-Za-z0-9\-_]+$/);
  });

  it("returns a different value each call", () => {
    assert.notStrictEqual(generateCodeVerifier(), generateCodeVerifier());
  });
});

describe("generateCodeChallenge()", () => {
  it("matches the known S256 challenge for a fixed verifier (RFC 7636 example)", () => {
    // Verifier/challenge pair from RFC 7636 Appendix B.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = generateCodeChallenge(verifier);
    assert.strictEqual(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("generateState()", () => {
  it("returns a different value each call", () => {
    assert.notStrictEqual(generateState(), generateState());
  });
});

describe("isTokenExpired()", () => {
  it("returns true when there are no tokens", () => {
    assert.strictEqual(isTokenExpired(null), true);
  });

  it("returns true when expiresAt is in the past", () => {
    assert.strictEqual(isTokenExpired({ expiresAt: 1000 }, 2000), true);
  });

  it("returns true when within the 60s safety margin of expiring", () => {
    assert.strictEqual(isTokenExpired({ expiresAt: 100_000 }, 100_000 - 30_000), true);
  });

  it("returns false when well before expiry", () => {
    assert.strictEqual(isTokenExpired({ expiresAt: 100_000 }, 10_000), false);
  });
});

describe("token file I/O", () => {
  function tempFilePath() {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mmm-spotify-sonos-")), "spotify_access_token.json");
  }

  it("readTokenFile returns null when the file does not exist", () => {
    assert.strictEqual(readTokenFile(tempFilePath()), null);
  });

  it("writeTokenFile then readTokenFile round-trips the tokens", () => {
    const filePath = tempFilePath();
    const tokens = { accessToken: "a", refreshToken: "r", expiresAt: 12345 };
    writeTokenFile(filePath, tokens);
    assert.deepStrictEqual(readTokenFile(filePath), tokens);
  });

  it("readTokenFile returns null for malformed JSON", () => {
    const filePath = tempFilePath();
    fs.writeFileSync(filePath, "not json", "utf8");
    assert.strictEqual(readTokenFile(filePath), null);
  });

  it("deleteTokenFile removes an existing file and is a no-op if already gone", () => {
    const filePath = tempFilePath();
    writeTokenFile(filePath, { accessToken: "a", refreshToken: "r", expiresAt: 1 });
    deleteTokenFile(filePath);
    assert.strictEqual(fs.existsSync(filePath), false);
    assert.doesNotThrow(() => deleteTokenFile(filePath));
  });
});

describe("buildAuthorizeUrl()", () => {
  it("includes all required PKCE and OAuth parameters", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "client123",
        redirectUri: "http://localhost:8888/callback",
        codeChallenge: "challenge123",
        state: "state123",
        scopes: ["scope-a", "scope-b"]
      })
    );
    assert.strictEqual(url.origin + url.pathname, "https://accounts.spotify.com/authorize");
    assert.strictEqual(url.searchParams.get("client_id"), "client123");
    assert.strictEqual(url.searchParams.get("response_type"), "code");
    assert.strictEqual(url.searchParams.get("redirect_uri"), "http://localhost:8888/callback");
    assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
    assert.strictEqual(url.searchParams.get("code_challenge"), "challenge123");
    assert.strictEqual(url.searchParams.get("state"), "state123");
    assert.strictEqual(url.searchParams.get("scope"), "scope-a scope-b");
  });
});

describe("exchangeCodeForTokens()", () => {
  it("posts the authorization_code grant and returns shaped tokens", async () => {
    let capturedBody = null;
    const fakeFetch = async (url, options) => {
      capturedBody = new URLSearchParams(options.body);
      return {
        ok: true,
        json: async () => ({ access_token: "AT", refresh_token: "RT", expires_in: 3600 })
      };
    };
    const before = Date.now();
    const tokens = await exchangeCodeForTokens(fakeFetch, {
      code: "CODE",
      codeVerifier: "VERIFIER",
      redirectUri: "http://localhost:8888/callback",
      clientId: "client123"
    });
    assert.strictEqual(tokens.accessToken, "AT");
    assert.strictEqual(tokens.refreshToken, "RT");
    assert.ok(tokens.expiresAt >= before + 3600 * 1000);
    assert.strictEqual(capturedBody.get("grant_type"), "authorization_code");
    assert.strictEqual(capturedBody.get("code"), "CODE");
    assert.strictEqual(capturedBody.get("code_verifier"), "VERIFIER");
    assert.strictEqual(capturedBody.get("client_id"), "client123");
  });

  it("throws with the status code when the token endpoint rejects the request", async () => {
    const fakeFetch = async () => ({ ok: false, status: 400 });
    await assert.rejects(() => exchangeCodeForTokens(fakeFetch, { code: "x", codeVerifier: "y", redirectUri: "z", clientId: "c" }), /400/);
  });
});

describe("refreshAccessToken()", () => {
  it("posts the refresh_token grant and returns shaped tokens", async () => {
    let capturedBody = null;
    const fakeFetch = async (url, options) => {
      capturedBody = new URLSearchParams(options.body);
      return {
        ok: true,
        json: async () => ({ access_token: "AT2", expires_in: 3600 })
      };
    };
    const tokens = await refreshAccessToken(fakeFetch, { refreshToken: "RT", clientId: "client123" });
    assert.strictEqual(tokens.accessToken, "AT2");
    // Spotify's refresh response can omit refresh_token when it hasn't rotated -- fall back to the old one.
    assert.strictEqual(tokens.refreshToken, "RT");
    assert.strictEqual(capturedBody.get("grant_type"), "refresh_token");
    assert.strictEqual(capturedBody.get("refresh_token"), "RT");
  });

  it("uses the rotated refresh_token when the response includes one", async () => {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({ access_token: "AT2", refresh_token: "RT2", expires_in: 3600 })
    });
    const tokens = await refreshAccessToken(fakeFetch, { refreshToken: "RT", clientId: "client123" });
    assert.strictEqual(tokens.refreshToken, "RT2");
  });

  it("throws with the status code when refresh fails", async () => {
    const fakeFetch = async () => ({ ok: false, status: 401 });
    await assert.rejects(() => refreshAccessToken(fakeFetch, { refreshToken: "x", clientId: "c" }), /401/);
  });
});

describe("startCallbackServer()", () => {
  it("invokes onCallback with the code and state from a /callback request, then the response body confirms success", async () => {
    let received = null;
    const server = await startCallbackServer(0, (result) => {
      received = result;
    });
    const { port } = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/callback?code=ABC&state=XYZ`);
    const body = await response.text();

    assert.strictEqual(response.status, 200);
    assert.match(body, /close this window/i);
    assert.deepStrictEqual(received, { code: "ABC", state: "XYZ", error: null });

    await new Promise((resolve) => server.close(resolve));
  });

  it("reports the error query parameter when the user denies access", async () => {
    let received = null;
    const server = await startCallbackServer(0, (result) => {
      received = result;
    });
    const { port } = server.address();

    await fetch(`http://127.0.0.1:${port}/callback?error=access_denied&state=XYZ`);

    assert.deepStrictEqual(received, { code: null, state: "XYZ", error: "access_denied" });
    await new Promise((resolve) => server.close(resolve));
  });

  it("responds 404 for any path other than /callback", async () => {
    const server = await startCallbackServer(0, () => {});
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/something-else`);
    assert.strictEqual(response.status, 404);
    await new Promise((resolve) => server.close(resolve));
  });
});
