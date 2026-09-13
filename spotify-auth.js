"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

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

module.exports = {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  isTokenExpired,
  readTokenFile,
  writeTokenFile,
  deleteTokenFile
};
