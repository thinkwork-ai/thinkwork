// defineExtension — validate + brand an extension definition at authoring time.
//
// Mirrors @thinkwork/pi-extensions' define-extension.ts: reject a malformed extension
// (missing name or register fn) when it's authored, not when the session loads it. Keeps
// authoring errors close to the mistake.

import type { Extension, ExtensionFactory } from "./types";

export function defineExtension(extension: Extension): ExtensionFactory {
  if (!extension || typeof extension !== "object") {
    throw new Error("defineExtension requires an extension object.");
  }
  if (typeof extension.name !== "string" || extension.name.trim() === "") {
    throw new Error("Extension is missing a non-empty `name`.");
  }
  if (typeof extension.register !== "function") {
    throw new Error(
      `Extension "${extension.name}" is missing a \`register\` function.`,
    );
  }
  return extension;
}
