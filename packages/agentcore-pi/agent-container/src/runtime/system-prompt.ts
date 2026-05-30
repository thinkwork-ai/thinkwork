/**
 * Plan §004 U6 — system-prompt composition moved to the shared
 * `@thinkwork/pi-extensions` package so both hosts use one path and it can run
 * inside a `before_agent_start` extension hook. This module re-exports the
 * composition surface for the existing in-container callers (and the parity
 * test); the live wiring is now `createSystemPromptExtension` in server.ts.
 */
export {
  composeSystemPrompt,
  type ComposeSystemPromptArgs,
  type PiInvocationPayload,
  type WorkspaceFileReader,
} from "@thinkwork/pi-extensions";
