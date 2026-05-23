/**
 * Public entry point for @thinkwork/pi-aws.
 *
 * Re-exports the connector and local sandbox types so consumers can import
 * everything they need from the package root.
 *
 * Plan §005 U8 added these exports so packages/agentcore-pi can wire
 * the AgentCore Code Interpreter sandbox into its handler without
 * mirroring tsconfig-path tricks.
 */

export {
  agentcoreCodeInterpreter,
  AgentcoreCodeInterpreterApi,
} from "../connectors/agentcore-codeinterpreter.js";
export type { AgentcoreCodeInterpreterOptions } from "../connectors/agentcore-codeinterpreter.js";

// Local sandbox type surface used by the Pi runtime.
export type {
  ShellResult,
  FileStat,
  SandboxApi,
  SessionEnv,
  SandboxFactory,
} from "./sandbox-types.js";
