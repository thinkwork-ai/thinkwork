import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Message, Usage } from "@earendil-works/pi-ai";

export interface ToolCostRecord {
  provider: string;
  event_type: string;
  amount_usd: number | string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface ToolInvocationRecord {
  id: string;
  name: string;
  tool_name: string;
  args?: unknown;
  result?: unknown;
  is_error?: boolean;
  /** Short string previews the thread UI renders as Input/Output/Status. */
  input_preview?: string;
  output_preview?: string;
  status?: string;
  started_at?: string;
  finished_at?: string;
  runtime: "pi";
}

export interface PiRetainStatus {
  /** True when the per-turn auto-retain Lambda invoke was dispatched. */
  retained: boolean;
  /** Present when the invoke was attempted but failed; absent otherwise. */
  error?: string;
}

export interface InvocationResponse {
  response: {
    role: "assistant";
    content: string;
    runtime: "pi";
    model: string;
    usage?: Usage;
    tools_called?: string[];
    tool_invocations?: ToolInvocationRecord[];
    tool_costs?: ToolCostRecord[];
    hindsight_usage?: unknown[];
  };
  runtime: "pi";
  composed_system_prompt: string;
  pi_usage?: Usage;
  pi_retain?: PiRetainStatus;
  mcp_proxy_registered?: boolean;
  tools_called?: string[];
  tool_invocations?: ToolInvocationRecord[];
  tool_costs?: ToolCostRecord[];
  hindsight_usage?: unknown[];
}

export interface PiInvocationIdentity {
  tenantId: string;
  userId?: string;
  agentId: string;
  threadId: string;
  tenantSlug?: string;
  agentSlug?: string;
  traceId?: string;
}

export interface RunAgentLoopArgs {
  message: string;
  history: Message[];
  systemPrompt: string;
  tools: AgentTool<any>[];
  modelId: unknown;
  threadId: string;
  gitSha: string;
  identity?: unknown;
  /**
   * Workspace directory the agent session runs against (built-in file tools,
   * project context discovery). Defaults to `process.cwd()` when omitted.
   */
  cwd?: string;
}

export interface RunAgentLoopResult {
  content: string;
  usage?: Usage;
  modelId: string;
  toolsCalled: string[];
  toolInvocations: ToolInvocationRecord[];
  toolCosts?: ToolCostRecord[];
}

export interface PiRuntimeLogEntry {
  level: "info" | "warn" | "error";
  event: string;
  tenantId?: string;
  userId?: string;
  agentId?: string;
  threadId?: string;
  traceId?: string;
  [key: string]: unknown;
}
