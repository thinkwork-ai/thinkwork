import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { RuntimeEnv } from "../env-snapshot.js";
import type { WorkspaceSkill } from "./workspace-skills.js";

export interface PiInvocationPayload {
  tenant_id?: unknown;
  workspace_tenant_id?: unknown;
  assistant_id?: unknown;
  thread_id?: unknown;
  user_id?: unknown;
  trace_id?: unknown;
  message?: unknown;
  model?: unknown;
  messages_history?: unknown;
  use_memory?: unknown;
  tenant_slug?: unknown;
  instance_id?: unknown;
  agent_name?: unknown;
  system_prompt?: unknown;
  thinkwork_api_url?: unknown;
  thinkwork_api_secret?: unknown;
  hindsight_endpoint?: unknown;
  web_search_config?: unknown;
  send_email_config?: unknown;
  context_engine_enabled?: unknown;
  context_engine_config?: unknown;
  sandbox_interpreter_id?: unknown;
  sandbox_environment?: unknown;
  sandbox_status?: unknown;
  sandbox_reason?: unknown;
  mcp_configs?: unknown;
}

export interface PiToolInvocation {
  id: string;
  name: string;
  tool_name: string;
  args?: unknown;
  result?: unknown;
  is_error?: boolean;
  started_at?: string;
  finished_at?: string;
  runtime: "pi";
  source?: string;
  server_name?: string;
}

export interface HindsightUsage {
  phase: "retain" | "reflect";
  model: string;
  input_tokens: number;
  output_tokens: number;
}

export interface ToolRuntimeState {
  toolInvocations: PiToolInvocation[];
  hindsightUsage: HindsightUsage[];
  cleanup: Array<() => Promise<void>>;
}

export interface PiToolContext {
  payload: PiInvocationPayload & Record<string, unknown>;
  env: RuntimeEnv;
  state: ToolRuntimeState;
  workspaceSkills?: WorkspaceSkill[];
}

export interface BuiltPiTools {
  tools: AgentTool<any>[];
  cleanup: Array<() => Promise<void>>;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function optionalBoolean(value: unknown): boolean {
  return value === true || value === "true";
}
