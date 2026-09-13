"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");

const EXPIRY_SAFETY_MARGIN_MS = 60 * 1000;

function base64UrlEncode(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateCodeVerifier() {
  return base64UrlEncode(crypto.randomBytes(64));
}

function generateCodeChallenge(codeVerifier) {
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  return base64UrlEncode(hash);
}

function generateState() {
  return base64UrlEncode(crypto.randomBytes(16));
}

function isTokenExpired(tokens, nowMs = Date.now()) {
  if (!tokens || !tokens.expiresAt) return true;
  return nowMs >= tokens.expiresAt - EXPIRY_SAFETY_MARGIN_MS;
}

function readTokenFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeTokenFile(filePath, tokens) {
  fs.writeFileSync(filePath, JSON.stringify(tokens, null, 2), "utf8");
}

function deleteTokenFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Already gone — nothing to do.
  }
}

function buildAuthorizeUrl({ clientId, redirectUri, codeChallenge, state, scopes }) {
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", scopes.join(" "));
  return url.toString();
}

async function requestTokens(fetchImpl, params) {
  const response = await fetchImpl("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString()
  });
  if (!response.ok) {
    throw new Error(`Spotify token endpoint returned ${response.status}`);
  }
  return response.json();
}

async function exchangeCodeForTokens(fetchImpl, { code, codeVerifier, redirectUri, clientId }) {
  const json = await requestTokens(fetchImpl, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier
  });
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000
  };
}

async function refreshAccessToken(fetchImpl, { refreshToken, clientId }) {
  const json = await requestTokens(fetchImpl, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId
  });
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000
  };
}

function startCallbackServer(port, onCallback) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>Logged in. You can close this window now.</body></html>");
      onCallback({
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
        error: url.searchParams.get("error")
      });
    });
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}

module.exports = {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  isTokenExpired,
  readTokenFile,
  writeTokenFile,
  deleteTokenFile,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  startCallbackServer
};
