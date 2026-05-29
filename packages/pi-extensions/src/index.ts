export * from "./define-extension.js";
export * from "./memory.js";

// Re-export the SDK extension types so hosts can type their wiring (e.g. an
// `ExtensionFactory[]` field) without taking a direct dependency on the heavy
// `@earendil-works/pi-coding-agent` package — pi-extensions is its authoring home.
export type {
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
