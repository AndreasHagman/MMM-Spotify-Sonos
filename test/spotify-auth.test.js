"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { generateCodeVerifier, generateCodeChallenge, generateState, isTokenExpired, readTokenFile, writeTokenFile, deleteTokenFile } = require("../spotify-auth");

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
