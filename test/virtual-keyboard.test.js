"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { resolveKeyboardCommand } = require("../virtual-keyboard");

describe("resolveKeyboardCommand()", () => {
  it("accepts a bare command string", () => {
    assert.deepStrictEqual(resolveKeyboardCommand("matchbox-keyboard"), { command: "matchbox-keyboard", args: [] });
  });

  it("trims whitespace around a bare command string", () => {
    assert.deepStrictEqual(resolveKeyboardCommand("  matchbox-keyboard  "), { command: "matchbox-keyboard", args: [] });
  });

  it("accepts a [command, ...args] array for keyboards that need flags", () => {
    assert.deepStrictEqual(resolveKeyboardCommand(["wvkbd-mobintl", "-l", "landscape"]), { command: "wvkbd-mobintl", args: ["-l", "landscape"] });
  });

  it("returns null when unset (feature disabled by default)", () => {
    assert.strictEqual(resolveKeyboardCommand(null), null);
    assert.strictEqual(resolveKeyboardCommand(undefined), null);
  });

  it("returns null for an empty or whitespace-only string", () => {
    assert.strictEqual(resolveKeyboardCommand(""), null);
    assert.strictEqual(resolveKeyboardCommand("   "), null);
  });

  it("returns null for an empty array or an array whose first element isn't a usable command", () => {
    assert.strictEqual(resolveKeyboardCommand([]), null);
    assert.strictEqual(resolveKeyboardCommand([""]), null);
    assert.strictEqual(resolveKeyboardCommand([42]), null);
  });

  it("returns null for other unexpected types rather than throwing", () => {
    assert.strictEqual(resolveKeyboardCommand(42), null);
    assert.strictEqual(resolveKeyboardCommand({}), null);
  });
});
