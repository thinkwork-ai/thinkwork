/**
 * Public entry point for @thinkwork/flue-aws.
 *
 * Re-exports the connector + relevant Flue types so consumers can import
 * everything they need from the package root without resolving the
 * `@flue/sdk/sandbox` path-remap themselves.
 *
 * Plan §005 U8 added these exports so packages/agentcore-flue can wire
 * the AgentCore Code Interpreter sandbox into its handler without
 * mirroring tsconfig-path tricks.
 */

export {
  agentcoreCodeInterpreter,
  AgentcoreCodeInterpreterApi,
} from "../connectors/agentcore-codeinterpreter.js";
export type { AgentcoreCodeInterpreterOptions } from "../connectors/agentcore-codeinterpreter.js";

// Vendored Flue type stubs (replace with `@flue/sdk/sandbox` once published).
export type {
  ShellResult,
  FileStat,
  SandboxApi,
  SessionEnv,
  SandboxFactory,
} from "./flue-types.js";
