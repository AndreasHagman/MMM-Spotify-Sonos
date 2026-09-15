"use strict";

// Normalizes the `virtualKeyboardCommand` config value into a spawn()-ready
// {command, args} pair. Accepts a bare command string ("matchbox-keyboard")
// or a [command, ...args] array for keyboards that need flags (e.g. wvkbd's
// layout flag). The config defaults to null/unset, which keeps the feature
// off — nobody who doesn't set this touches a spawned process at all.
function resolveKeyboardCommand(virtualKeyboardCommand) {
  if (typeof virtualKeyboardCommand === "string") {
    const command = virtualKeyboardCommand.trim();
    return command ? { command, args: [] } : null;
  }

  if (Array.isArray(virtualKeyboardCommand)) {
    const [rawCommand, ...args] = virtualKeyboardCommand;
    if (typeof rawCommand !== "string") return null;
    const command = rawCommand.trim();
    return command ? { command, args } : null;
  }

  return null;
}

module.exports = { resolveKeyboardCommand };
