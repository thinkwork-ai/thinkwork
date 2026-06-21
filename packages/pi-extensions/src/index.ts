export * from "./define-extension.js";
export * from "./analytics-display.js";
export * from "./ask-user-question.js";
export * from "./attachments.js";
export * from "./browser.js";
export * from "./context-engine.js";
export * from "./delegation.js";
export * from "./fetch-workspace-source.js";
export * from "./knowledge-graph.js";
export * from "./memory.js";
export * from "./send-email.js";
export * from "./skills.js";
export * from "./system-prompt.js";
export * from "./task-status.js";
export * from "./web-extract.js";
export * from "./web-search.js";

// Re-export the SDK extension types so hosts can type their wiring (e.g. an
// `ExtensionFactory[]` field) without taking a direct dependency on the heavy
// `@earendil-works/pi-coding-agent` package — pi-extensions is its authoring home.
export type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
