import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Message, Usage } from "@mariozechner/pi-ai";

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
