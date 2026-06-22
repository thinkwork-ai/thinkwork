import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Message, Usage } from "@earendil-works/pi-ai";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ThreadGenUIPart } from "@thinkwork/genui";

import type { SessionStore } from "./durable-session-manager.js";
import type { ModelRoutedToolCallRecord } from "./model-routing-policy.js";
import type { OkfWikiContextTrace } from "./okf-wiki-navigator.js";

export type AgentProfileRunStatus =
  | "completed"
  | "failed"
  | "timed_out"
  | "interrupted"
  | "resource_limit_exceeded";

export type AgentProfileLoopCompletionVerdict =
  | "pass"
  | "revise"
  | "fail"
  | "needs_clarification";

/** Mirrors the ask_user_question tool's option contract (plan 2026-06-09-005 U6). */
export interface AgentProfileHandoffQuestionOption {
  label: string;
  description?: string;
}

/** Mirrors the ask_user_question tool's question contract (plan 2026-06-09-005 U6). */
export interface AgentProfileHandoffQuestion {
  question: string;
  header?: string;
  options?: AgentProfileHandoffQuestionOption[];
  multiSelect?: boolean;
}

export interface AgentProfileHandoffEvidence {
  verdict: AgentProfileLoopCompletionVerdict;
  summary: string;
  confidence?: "low" | "medium" | "high";
  evidence?: string[];
  feedback?: string;
  /** Present only with verdict needs_clarification (max 4 questions). */
  questions?: AgentProfileHandoffQuestion[];
}

export interface AgentProfileLoopEvidence {
  source: "thinkwork_agent_profile_loop";
  loopId: string;
  profileRunId: string;
  owner: {
    type: "profile";
    profileId: string;
    profileSlug: string;
    profileName: string;
  };
  policy: unknown;
  phases: Array<{
    phase: string;
    status: string;
    summary?: string;
    feedback?: string;
  }>;
  goalState: unknown;
  handoff?: AgentProfileHandoffEvidence;
}

export interface AgentProfileRunRecord {
  profileRunId: string;
  profileId: string;
  profileSlug: string;
  profileName: string;
  model: string;
  status: AgentProfileRunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  parentThreadTurnId: string;
  handoffSummary: string | null;
  handoff?: AgentProfileHandoffEvidence;
  loopEvidence?: AgentProfileLoopEvidence;
  toolInvocations: ToolInvocationRecord[];
  laneKey: string;
  error?: string;
}

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
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cached_read_tokens?: number;
  cost_usd?: number;
  model_routing_status?: string;
  model_routing_rule_source?: Record<string, unknown>;
  model_routing_match?: Record<string, unknown>;
  /** Short string previews the thread UI renders as Input/Output/Status. */
  input_preview?: string;
  output_preview?: string;
  status?: string;
  model_routing?: ModelRoutedToolCallRecord;
  agent_profile_run?: AgentProfileRunRecord;
  okf_wiki_trace?: OkfWikiContextTrace;
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

export type GoalRunStatus =
  | "active"
  | "paused"
  | "budget_limited"
  | "complete"
  | "cleared";

export interface GoalRunEvidence {
  source: "pi_goal";
  action?: "start" | "resume" | "pause" | "cancel" | "clear";
  goal_id?: string;
  objective?: string;
  status: GoalRunStatus;
  iteration?: number;
  token_budget?: number;
  tokens_used?: number;
  time_used_seconds?: number;
  started_at?: string;
  updated_at?: string;
  completion_summary?: string;
  budget_limited_reason?: string;
  continuation_policy?: "thinkwork_managed";
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
    ui_message_parts?: ThreadGenUIPart[];
    model_routed_tool_calls?: ModelRoutedToolCallRecord[];
    agent_profile_runs?: AgentProfileRunRecord[];
    tool_costs?: ToolCostRecord[];
    hindsight_usage?: unknown[];
    goal_run?: GoalRunEvidence;
  };
  runtime: "pi";
  composed_system_prompt: string;
  pi_usage?: Usage;
  pi_retain?: PiRetainStatus;
  mcp_proxy_registered?: boolean;
  tools_called?: string[];
  tool_invocations?: ToolInvocationRecord[];
  ui_message_parts?: ThreadGenUIPart[];
  model_routed_tool_calls?: ModelRoutedToolCallRecord[];
  agent_profile_runs?: AgentProfileRunRecord[];
  tool_costs?: ToolCostRecord[];
  hindsight_usage?: unknown[];
  goal_run?: GoalRunEvidence;
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
  /**
   * Prebuilt system prompt. Optional as of U6: when a system-prompt extension
   * composes the prompt via `before_agent_start`, the host omits this and the
   * loop installs no override.
   */
  systemPrompt?: string;
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
  /**
   * Private Pi SDK state directory for auth/settings/session scratch. Defaults
   * under `cwd` for local hosts; managed AgentCore passes a `/tmp` directory so
   * SDK control files never appear in the rendered workspace.
   */
  agentDir?: string;
  /**
   * Durable per-thread session store. When present (with a non-empty
   * `threadId`), the turn resumes the thread's persisted session instead of
   * replaying `history` as prompt text. U4.
   */
  sessionStore?: SessionStore;
  /** Local scratch directory for the SDK session file (defaults under `cwd`). */
  sessionDir?: string;
  /**
   * Pi extension factories loaded into the session's resource loader (the U1
   * serverless mechanism — `DefaultResourceLoader.extensionFactories`). The host
   * builds these from `@thinkwork/pi-extensions` closed over its U3 provider
   * bundle; the loop stays host-agnostic and only forwards them. U5.
   */
  extensionFactories?: ExtensionFactory[];
  /**
   * Names of tools registered by the loaded extensions. Folded into the
   * `createAgentSession` allowlist so extension tools (e.g. memory's
   * `recall`/`reflect`) are actually enabled — the SDK gates to the allowlist,
   * so extension tools omitted from it register but never reach the model. U6.
   */
  extensionToolNames?: string[];
  /**
   * Optional built-in allowlist for child/profile runs. Parent turns omit this
   * and keep the full ThinkWork Pi built-in set.
   */
  builtinToolNames?: string[];
  /**
   * Optional host-provided extractor for extension-managed goal evidence. The
   * core loop stays extension-agnostic and passes the post-turn session entries
   * plus recorded tool results back to the host package that understands them.
   */
  goalRunExtractor?: (args: {
    sessionEntries: unknown[];
    toolInvocations: ToolInvocationRecord[];
  }) => GoalRunEvidence | undefined;
}

export interface RunAgentLoopResult {
  content: string;
  usage?: Usage;
  modelId: string;
  toolsCalled: string[];
  toolInvocations: ToolInvocationRecord[];
  uiMessageParts?: ThreadGenUIPart[];
  modelRoutedToolCalls?: ModelRoutedToolCallRecord[];
  agentProfileRuns?: AgentProfileRunRecord[];
  toolCosts?: ToolCostRecord[];
  diagnostics?: Record<string, unknown>;
  goalRun?: GoalRunEvidence;
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
