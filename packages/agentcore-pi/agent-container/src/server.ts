/**
 * Plan §005 U9 — Trusted handler shell (the keystone unit).
 *
 * This is the production entry point for the agentcore-pi Lambda /
 * AgentCore runtime container. It binds U4-U8 into a single per-invocation
 * orchestrator:
 *
 *   - U4: AuroraSessionStore — Pi's session-blob persistence.
 *   - U5: run_skill ToolDef   — subprocess bridge to Python script-skills.
 *   - U6: Memory ToolDefs     — AgentCore Managed OR Hindsight, selected by
 *                                MEMORY_ENGINE env. Both modules are imported;
 *                                only the active one's tools reach the agent.
 *   - U7: HandleStore + buildMcpTools — handle-shaped Authorization, with the
 *                                       real `connectMcpServer` factory wired
 *                                       in here (no inert default).
 *   - U8: AgentCore Code Interpreter sandbox factory.
 *
 * Lifecycle invariants (FR-3a + FR-4a):
 *
 *   1. EVERY invocation gets a fresh HandleStore. The `try { … } finally {
 *      handleStore.clear() }` wrap below is load-bearing — without it, a warm
 *      Lambda container would carry handles across invocations and cross-
 *      tenant isolation would silently fail.
 *   2. Identity (tenantId, userId, agentId, threadId) is snapshotted at
 *      payload-parse time and never re-read from `process.env`.
 *   3. API_AUTH_SECRET / THINKWORK_API_URL come from the invocation payload
 *      (chat-agent-invoke fills them) and are snapshotted at the same time
 *      (see `feedback_completion_callback_snapshot_pattern`).
 *   4. MCP URLs are validated BEFORE handle minting so a malicious payload
 *      cannot exfiltrate handles by pointing them at file:// or IMDS.
 *   5. Connect failures + bearer-rejected configs surface through
 *      `onConnectError` → `logStructured` → CloudWatch. The agent loses one
 *      MCP server's tools but the turn proceeds.
 *
 * Worker isolation (U16): U9 ships the handler with an in-process Agent
 * loop — no `worker_thread.spawn(...)` yet. Per the plan, U16 wraps this
 * loop in a worker so handle resolution + response-body scrubbing happen
 * outside the trusted handler's address space. Until U16, the handle store
 * is functionally equivalent to a bearer (anyone with code execution in this
 * process can read it). The handle scheme is still load-bearing — it's the
 * wire format the worker thread will key off of.
 */

import http from "node:http";
import {
  Agent,
  type AgentEvent,
  type AgentTool,
} from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  Message,
  TextContent,
  Usage,
} from "@mariozechner/pi-ai";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";

import {
  InvocationValidationError,
  logStructured,
  snapshotIdentity,
  snapshotRuntimeEnv,
  snapshotSecrets,
  validateMcpUrl,
  type IdentitySnapshot,
  type RuntimeEnvSnapshot,
  type SecretsSnapshot,
} from "./handler-context.js";
import {
  HandleStore,
  buildMcpTools,
  type ConnectMcpServerFn,
  type McpServerConfig,
} from "./mcp.js";
import { createConnectMcpServer } from "./mcp-connect.js";
import {
  McpToolRegistry,
  validateDirectTools,
  type DirectToolsMismatch,
} from "./mcp-registry.js";
import { buildMcpProxyTool } from "./mcp-proxy.js";
import {
  readMcpJson,
  McpJsonError,
  type McpJsonConfig,
} from "./runtime/mcp-json.js";
import { createScrubbingFetch } from "./scrubbing-fetch.js";
import { buildHindsightTools } from "./tools/hindsight.js";
import { buildMemoryTools } from "./tools/memory.js";
import {
  AuroraSessionStore,
  type AuroraSessionStoreOptions,
} from "./sessionstore-aurora.js";
import { resolveSandboxFactory } from "./runtime/sandbox-factory.js";
import { bootstrapWorkspace } from "./runtime/bootstrap-workspace.js";
import { composeSystemPrompt } from "./runtime/system-prompt.js";
import {
  buildFileReadTool,
  cleanupMessageAttachments,
  formatMessageAttachmentsPreamble,
  stageMessageAttachments,
} from "./runtime/message-attachments.js";
import {
  retainConversation,
  type RetainPayloadInput,
} from "./runtime/tools/memory-retain-client.js";
import { buildRunSkillTool } from "./runtime/tools/run-skill.js";
import { buildExecuteCodeTool } from "./runtime/tools/execute-code.js";
import { buildBrowserAutomationTool } from "./runtime/tools/browser-automation.js";
import { buildSendEmailTool } from "./runtime/tools/send-email.js";
import {
  collectToolCosts,
  type ToolCostRecord,
} from "./runtime/tools/tool-costs.js";
import {
  discoverWorkspaceSkills,
  formatWorkspaceSkills,
  type WorkspaceSkill,
} from "./runtime/tools/workspace-skills.js";

const PORT = Number(process.env.PORT || 8080);

// ---------------------------------------------------------------------------
// Types — payload + response shapes the handler exposes.
// ---------------------------------------------------------------------------

/**
 * Tool-invocation record. Mirrors `PiToolInvocation` from the deleted
 * pi-mono runtime — `chat-agent-invoke.ts:721/754` reads these fields off
 * the response and persists them onto `thread_turns.tool_invocations`. The
 * Pi runtime must keep emitting them or the admin UI / eval-runner /
 * thread inspector all lose tool visibility.
 */
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
  /**
   * The composed system prompt the agent loop ran against (workspace files
   * + runtime tool policy + attachment preamble). Eval invocations capture
   * this for the result-detail "View System Prompt" sheet so operators can
   * audit exactly what the LLM saw, not just the per-case override stored
   * on the test case. Present on every response — there is no opt-in.
   */
  composed_system_prompt: string;
  pi_usage?: Usage;
  /**
   * End-of-turn auto-retain dispatch status. Surfaces whether the
   * runtime invoked the `memory-retain` Lambda for this turn. Used by
   * the post-deploy smoke to pin the auto-retain wiring against
   * regressions where the response is otherwise healthy but retain
   * silently no-ops.
   */
  pi_retain?: PiRetainStatus;
  /**
   * Plan §006 U4 — pinning field for the MCP proxy substrate. True when
   * the inert (or future live) `mcp` AgentTool was registered for this
   * invocation. The post-deploy smoke asserts this field is a boolean so
   * a regression that drops the field (e.g., a response-builder rewrite
   * that forgets to surface it) fails the smoke even before U5 makes
   * the proxy actually useful. The full transition path is:
   *   - PR-1 (U3 + U4): field present, value tracks proxy registration
   *   - PR-2 (U5):      value is true on every invocation with MCP configs,
   *                     and a sibling `mcp_proxy_used: true` lands when the
   *                     proxy's call mode was exercised at least once.
   */
  mcp_proxy_registered?: boolean;
  tools_called?: string[];
  tool_invocations?: ToolInvocationRecord[];
  tool_costs?: ToolCostRecord[];
  hindsight_usage?: unknown[];
}

interface HistoryMessage {
  role?: unknown;
  content?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Build a zero-valued Usage stub for synthesized history messages.
 * The history rows came from chat-agent-invoke's DB load; the original
 * per-turn token usage was not preserved across the wire. pi-ai requires
 * `usage` on every AssistantMessage but doesn't read these fields when
 * serializing history back to Bedrock — they're TypeScript metadata.
 */
function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * Convert chat-agent-invoke's wire-format history into the shape pi-ai's
 * `Agent.initialState.messages` requires.
 *
 * Wire format (from `packages/api/src/handlers/chat-agent-invoke.ts:300`):
 *   `[{ role: "user" | "assistant", content: string }, ...]`
 *
 * pi-ai's `UserMessage` accepts `content: string`. pi-ai's
 * `AssistantMessage` does NOT — it requires
 * `content: (TextContent | ThinkingContent | ToolCall)[]` plus required
 * metadata fields (`api`, `provider`, `model`, `usage`, `stopReason`,
 * `timestamp`). The original implementation passed `content` as a
 * string for both roles, which produced a structurally-invalid
 * `AssistantMessage`. pi-ai's Agent silently swallowed the malformed
 * input and returned an empty assistant turn — every multi-turn chat
 * with non-empty `messages_history` produced `content === ""` until
 * this fix.
 *
 * For the assistant fields that aren't carried over the wire (api,
 * provider, model, usage, stopReason), use the current invocation's
 * model and zero-valued metadata. These fields are not load-bearing
 * during pi-ai's history → Bedrock serialization; the Bedrock Messages
 * API only reads `role` and `content`.
 */
export function normalizeHistory(
  history: unknown,
  currentModelId: string,
): Message[] {
  if (!Array.isArray(history)) return [];
  return history.flatMap((entry: HistoryMessage) => {
    if (typeof entry.content !== "string" || !entry.content.trim()) return [];

    if (entry.role === "user") {
      return [
        {
          role: "user",
          content: entry.content,
          timestamp: Date.now(),
        } as Message,
      ];
    }

    if (entry.role === "assistant") {
      const textPart: TextContent = { type: "text", text: entry.content };
      return [
        {
          role: "assistant",
          content: [textPart],
          api: "bedrock-converse-stream",
          provider: "amazon-bedrock",
          model: currentModelId,
          usage: emptyUsage(),
          stopReason: "stop",
          timestamp: Date.now(),
        } as Message,
      ];
    }

    return [];
  });
}

function resolveModel(modelId: unknown) {
  const id =
    typeof modelId === "string" && modelId.trim()
      ? modelId.trim()
      : "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
  return getModel("amazon-bedrock", id as never);
}

function textFromAssistant(message: AssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function parseMcpConfigs(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const url = asString(record.url);
    const serverName =
      asString(record.name) || asString(record.serverName) || url;
    const auth =
      record.auth && typeof record.auth === "object"
        ? (record.auth as Record<string, unknown>)
        : undefined;
    const bearer = asString(auth?.token) || asString(record.bearer);
    if (!url || !serverName || !bearer) return [];
    return [
      {
        serverName,
        url,
        bearer,
        transport: record.transport === "sse" ? "sse" : "streamable-http",
        toolWhitelist: Array.isArray(record.tools)
          ? (record.tools.filter(
              (tool): tool is string => typeof tool === "string",
            ) as string[])
          : undefined,
      } as McpServerConfig,
    ];
  });
}

// ---------------------------------------------------------------------------
// Construction helpers — broken out so tests can swap factories.
// ---------------------------------------------------------------------------

export interface HandlerDependencies {
  /** AgentCore client factory — overridden in tests with aws-sdk-client-mock. */
  agentCoreClientFactory: () => BedrockAgentCoreClient;
  /** S3 client factory — overridden in tests. */
  s3ClientFactory: (region: string) => S3Client;
  /**
   * Lambda client factory — used by end-of-turn auto-retain to invoke the
   * `memory-retain` Lambda. Overridden in tests with a stubbed client.
   */
  lambdaClientFactory: (region: string) => LambdaClient;
  /** Optional override for the MCP connect factory (tests inject fakes). */
  connectMcpServerFactory?: ConnectMcpServerFn;
  /**
   * Optional override for the SessionStore constructor (tests inject fakes).
   * Production callers omit this and the default `AuroraSessionStore` runs.
   */
  sessionStoreFactory?: (opts: AuroraSessionStoreOptions) => AuroraSessionStore;
  /**
   * Optional override for the completion-callback HTTP fetch (tests inject
   * fakes). Production uses native `fetch` at invocation time.
   */
  fetchImpl?: typeof fetch;
  /** Optional override for the agent loop (test-only). */
  runAgentLoop?: typeof runAgentLoop;
  /** Optional override for the workspace S3 sync (test-only). */
  bootstrapWorkspaceImpl?: typeof bootstrapWorkspace;
  /** Optional override for per-turn attachment staging (test-only). */
  stageMessageAttachmentsImpl?: typeof stageMessageAttachments;
  /**
   * Optional override for workspace-skills discovery (test-only). The default
   * walks the local workspace tree.
   */
  discoverWorkspaceSkillsImpl?: typeof discoverWorkspaceSkills;
  /**
   * Test seam — invoked after the per-invocation `try { … } finally { … }`
   * block exits, with the assembled tool bundle. Tests use this to verify
   * the HandleStore was cleared regardless of how the agent loop completed.
   * Production callers omit this; the runtime never observes the bundle
   * after cleanup.
   */
  onHandlerComplete?: (bundle: AssembledToolBundle) => void;
}

const defaultDependencies: HandlerDependencies = {
  agentCoreClientFactory: () => new BedrockAgentCoreClient({}),
  s3ClientFactory: (region: string) => new S3Client({ region }),
  lambdaClientFactory: (region: string) => new LambdaClient({ region }),
};

// ---------------------------------------------------------------------------
// Tool assembly — pure given the snapshots + payload + factories.
// ---------------------------------------------------------------------------

export interface AssembledToolBundle {
  tools: AgentTool<any>[];
  cleanup: Array<() => Promise<void>>;
  workspaceSkills: WorkspaceSkill[];
  handleStore: HandleStore;
  /**
   * Plan §006 U4 — true when the inert `mcp` proxy AgentTool was added to
   * `tools` for this invocation. Surfaced onto the response payload as
   * `mcp_proxy_registered` so the post-deploy smoke can pin the
   * registration substrate. False when no MCP configs were present after
   * URL validation (no proxy needed when there's nothing to gateway to —
   * avoids polluting the agent's tool list when MCP is unused).
   */
  mcpProxyRegistered: boolean;
}

export interface AssembleToolsArgs {
  payload: Record<string, unknown>;
  identity: IdentitySnapshot;
  env: RuntimeEnvSnapshot;
  agentCoreClient: BedrockAgentCoreClient;
  workspaceSkills: WorkspaceSkill[];
  connectMcpServer: ConnectMcpServerFn;
  sessionStoreFactory: (opts: AuroraSessionStoreOptions) => AuroraSessionStore;
  /**
   * Per-invocation cleanup queue, allocated by the caller and shared with the
   * MCP connect factory. Tool builders push teardown closures here; the
   * trusted handler drains it in `finally`. Required so MCP transport
   * teardown lands in the SAME array the handler drains — not a private
   * array owned by the factory.
   */
  cleanup: Array<() => Promise<void>>;
  /**
   * U16 — Per-invocation `HandleStore` allocated by the caller. The
   * scrubbing fetch passed into `createConnectMcpServer` resolves
   * handles against THIS store; if assembleTools created its own
   * private one, the fetch would hold a stale reference and resolve
   * would always fail. Must be the same instance across the
   * trusted-handler / MCP-connect / buildMcpTools triangle.
   */
  handleStore: HandleStore;
  /**
   * Plan §006 U4 — parsed mcp.json workspace config (directTools allowlist
   * plus any future per-server fields). The trusted handler reads the
   * file post-bootstrap; this argument is the parsed result. An empty
   * `directTools` array means no boot-time allowlist validation runs
   * and every MCP tool is reachable only through the proxy.
   */
  mcpJsonConfig: McpJsonConfig;
  /**
   * Plan §006 U4 — per-invocation registry the MCP build path populates
   * with each (server, tool) pair. The proxy AgentTool reads from this
   * registry for list/search/call. Always allocated by the caller —
   * never module-level — so per-invocation isolation is preserved
   * alongside the HandleStore.
   */
  mcpRegistry: McpToolRegistry;
}

/**
 * Plan §006 U4 — thrown by `assembleTools` when an `mcp.json` directTools
 * entry references a (server, tool) the live MCP registry did not surface
 * after connect. The trusted handler catches this in its outer try/catch
 * and surfaces a structured 500 response so the operator sees the
 * mismatch in the agent's first turn instead of silent demotion.
 */
export class DirectToolsValidationError extends Error {
  constructor(public readonly missing: DirectToolsMismatch[]) {
    const summary = missing
      .map((m) =>
        m.reason === "server_not_configured"
          ? `${m.server}/${m.tool} (server not configured)`
          : `${m.server}/${m.tool} (server lists: [${m.availableTools.join(", ")}])`,
      )
      .join("; ");
    super(`directTools_validation_failed: ${summary}`);
    this.name = "DirectToolsValidationError";
  }
}

/**
 * Build the per-invocation tool surface. Returns the tool array plus a
 * `cleanup` queue the trusted handler drains in `finally`. Every choice
 * here is observable to the structured logger so an operator can audit
 * which tools the agent received.
 */
export async function assembleTools(
  args: AssembleToolsArgs,
): Promise<AssembledToolBundle> {
  const tools: AgentTool<any>[] = [];
  const cleanup = args.cleanup;
  // U16 — caller allocates the HandleStore so the scrubbing fetch
  // closure (built alongside `connectMcpServer` in handleInvocation)
  // resolves handles against the same store this build mints into.
  const handleStore = args.handleStore;

  // Run-skill (U5) — only adds the tool if the workspace has scripts.
  const runSkill = buildRunSkillTool({
    skills: [],
    // U5 expects a manifest of skillId/skillDir/scripts. The legacy
    // workspace-skills discovery returns SKILL.md descriptors, not the
    // script-bridge manifest. Wire-up of the script-bridge manifest is a
    // followup unit (tracked under FR-7 work). Until then run_skill is
    // exposed only when an explicit manifest is provided via env (out of
    // scope for U9).
  });
  if (runSkill) tools.push(runSkill);

  const sandboxInterpreterId = asString(args.payload.sandbox_interpreter_id);
  if (sandboxInterpreterId) {
    const sandboxFactory = resolveSandboxFactory(
      args.payload as { sandbox_interpreter_id: string },
      {
        client: args.agentCoreClient,
      },
    );
    tools.push(buildExecuteCodeTool({ sandboxFactory, cleanup }));
  } else if (args.payload.sandbox_status === "ready") {
    throw new Error(
      "Pi sandbox status is ready but `sandbox_interpreter_id` is missing.",
    );
  }

  if (args.payload.browser_automation_enabled === true) {
    tools.push(
      buildBrowserAutomationTool({
        client: args.agentCoreClient,
        traceId: asString(args.payload.trace_id) || undefined,
      }),
    );
  }

  if (
    typeof args.payload.send_email_config === "object" &&
    args.payload.send_email_config
  ) {
    const sendEmailTool = buildSendEmailTool({
      sendEmailConfig: args.payload.send_email_config as Record<
        string,
        unknown
      >,
      payload: args.payload,
    });
    if (sendEmailTool) tools.push(sendEmailTool);
  }

  // Memory (U6) — engine selector lives in env. Eval-mode invocations are
  // user-less by construction, so user-scoped memory + hindsight tools are
  // skipped entirely (matching `eval_tools_enabled: false` semantics in the
  // direct AgentCore eval payload).
  const evalMode = args.payload.eval_mode === true;
  if (evalMode) {
    logStructured({
      level: "info",
      event: "memory_skipped_eval_mode",
      tenantId: args.identity.tenantId,
      threadId: args.identity.threadId,
    });
  } else if (args.env.memoryEngine === "managed") {
    if (args.env.agentCoreMemoryId) {
      tools.push(
        ...buildMemoryTools({
          client: args.agentCoreClient,
          memoryId: args.env.agentCoreMemoryId,
          tenantId: args.identity.tenantId,
          userId: args.identity.userId,
          threadId: args.identity.threadId,
        }),
      );
    } else {
      logStructured({
        level: "warn",
        event: "memory_skipped_no_id",
        tenantId: args.identity.tenantId,
        threadId: args.identity.threadId,
      });
    }
  } else {
    if (args.env.hindsightEndpoint) {
      tools.push(
        ...buildHindsightTools({
          endpoint: args.env.hindsightEndpoint,
          tenantId: args.identity.tenantId,
          userId: args.identity.userId,
        }),
      );
    } else {
      logStructured({
        level: "warn",
        event: "hindsight_skipped_no_endpoint",
        tenantId: args.identity.tenantId,
        threadId: args.identity.threadId,
      });
    }
  }

  // MCP (U7) — validate, mint, build.
  const rawConfigs = parseMcpConfigs(args.payload.mcp_configs);
  const validatedConfigs: McpServerConfig[] = [];
  for (const config of rawConfigs) {
    const validation = validateMcpUrl(config.url);
    if (!validation.ok) {
      logStructured({
        level: "warn",
        event: "mcp_url_rejected",
        tenantId: args.identity.tenantId,
        userId: args.identity.userId,
        serverName: config.serverName,
        rejectionReason: validation.reason,
      });
      continue;
    }
    validatedConfigs.push(config);
  }
  const mcpTools = await buildMcpTools({
    mcpConfigs: validatedConfigs,
    handleStore,
    connectMcpServer: args.connectMcpServer,
    onConnectError: (err, config) => {
      logStructured({
        level: "warn",
        event: "mcp_connect_failed",
        tenantId: args.identity.tenantId,
        userId: args.identity.userId,
        serverName: config.serverName,
        error: err instanceof Error ? err.message : String(err),
      });
    },
    // Plan §006 U4 — populate the per-invocation registry as part of the
    // existing tools/list pass. No extra network round-trip.
    registry: args.mcpRegistry,
  });
  tools.push(...mcpTools);

  // Plan §006 U4 — boot-time validation of the directTools allowlist
  // against the live registry. Hard-fail (throw → outer catch in
  // handleInvocation drains cleanup + returns 500) so a typo or a
  // renamed MCP tool surfaces in the agent's first turn instead of
  // silently demoting the entry to proxy-only.
  let mcpProxyRegistered = false;
  if (validatedConfigs.length > 0) {
    const directToolsResult = validateDirectTools(
      args.mcpJsonConfig.directTools,
      args.mcpRegistry,
    );
    if (!directToolsResult.ok) {
      // Log a structured tenant-scoped event with a bounded shape so
      // operators see the mismatch in CloudWatch without echoing the
      // entire availableTools array into the log message (already on
      // the error throw the agent sees).
      logStructured({
        level: "error",
        event: "directtools_validation_failed",
        tenantId: args.identity.tenantId,
        userId: args.identity.userId,
        missingCount: directToolsResult.missing.length,
        missing: directToolsResult.missing.map((m) => ({
          server: m.server,
          tool: m.tool,
          reason: m.reason,
          availableToolCount: m.availableTools.length,
        })),
      });
      throw new DirectToolsValidationError(directToolsResult.missing);
    }

    // Plan §006 U4 — register the inert proxy AgentTool. U5 swaps the
    // execute body for the live list/search/call dispatcher. We only
    // ship the proxy when MCP configs are present (validatedConfigs > 0):
    // there's no reason for the model to see a `mcp` tool when there's
    // nothing to gateway to, and gating here mitigates the inert-pattern
    // model-context cost on agents without MCP wiring.
    tools.push(
      buildMcpProxyTool({
        mode: "inert",
        registry: args.mcpRegistry,
        connectMcpServer: args.connectMcpServer,
      }),
    );
    mcpProxyRegistered = true;
  }

  return {
    tools,
    cleanup,
    workspaceSkills: args.workspaceSkills,
    handleStore,
    mcpProxyRegistered,
  };
}

// ---------------------------------------------------------------------------
// Agent loop — placeholder dispatch (per U9 plan note: in-process Agent;
// worker_thread.spawn arrives in U16).
// ---------------------------------------------------------------------------

export interface RunAgentLoopArgs {
  message: string;
  history: Message[];
  systemPrompt: string;
  tools: AgentTool<any>[];
  modelId: unknown;
  threadId: string;
  gitSha: string;
  identity: IdentitySnapshot;
}

export interface RunAgentLoopResult {
  content: string;
  usage?: Usage;
  modelId: string;
  toolsCalled: string[];
  toolInvocations: ToolInvocationRecord[];
  toolCosts?: ToolCostRecord[];
}

export async function runAgentLoop(
  args: RunAgentLoopArgs,
): Promise<RunAgentLoopResult> {
  const model = resolveModel(args.modelId);
  const toolsCalled = new Set<string>();
  const toolInvocations: ToolInvocationRecord[] = [];

  const agent = new Agent({
    initialState: {
      systemPrompt: args.systemPrompt,
      model,
      messages: args.history,
      tools: args.tools,
    },
    streamFn: streamSimple,
    sessionId: args.threadId || undefined,
    onPayload: (bedrockPayload) => ({
      ...(bedrockPayload as Record<string, unknown>),
      requestMetadata: {
        runtime: "pi",
        git_sha: args.gitSha,
        thread_id: args.threadId,
      },
    }),
  });

  agent.subscribe((event: AgentEvent) => {
    if (event.type === "tool_execution_start") {
      toolsCalled.add(event.toolName);
      toolInvocations.push({
        id: event.toolCallId,
        name: event.toolName,
        tool_name: event.toolName,
        args: event.args,
        started_at: new Date().toISOString(),
        runtime: "pi",
      });
    }
    if (event.type === "tool_execution_end") {
      const existing = toolInvocations.find(
        (item) => item.id === event.toolCallId,
      );
      const finished = new Date().toISOString();
      if (existing) {
        existing.result = event.result;
        existing.is_error = event.isError;
        existing.finished_at = finished;
      } else {
        // Defensive — start event was lost (out-of-order delivery / mock test);
        // record what we have so the response shape stays consistent with
        // chat-agent-invoke's expectations.
        toolInvocations.push({
          id: event.toolCallId,
          name: event.toolName,
          tool_name: event.toolName,
          result: event.result,
          is_error: event.isError,
          finished_at: finished,
          runtime: "pi",
        });
      }
    }
  });

  await agent.prompt(args.message);
  const assistant = [...agent.state.messages]
    .reverse()
    .find(
      (message): message is AssistantMessage => message.role === "assistant",
    );

  return {
    content: textFromAssistant(assistant),
    usage: assistant?.usage,
    modelId: model.id,
    toolsCalled: [...toolsCalled],
    toolInvocations,
    toolCosts: toolInvocations.flatMap((invocation) =>
      collectToolCosts(invocation.result),
    ),
  };
}

// ---------------------------------------------------------------------------
// Completion callback — POST /api/skills/complete with snapshotted secret.
//
// IMPORTANT contract (mirrored from
// `packages/agentcore-strands/agent-container/container-sources/run_skill_dispatch.py`
// and validated against `packages/api/src/handlers/skills.ts`'s
// `completeSkillRunService`):
//
//   - Body uses camelCase: `runId`, `tenantId`, `status`, `failureReason?`,
//     `deliveredArtifactRef?`. Snake_case keys are silently ignored by the
//     endpoint and surface as a 400.
//   - Status enum is `complete | failed | cancelled | cost_bounded_error`.
//     `ok`/`error` are NOT accepted — they map to `complete`/`failed`.
//   - Auth is `Authorization: Bearer <api_auth_secret>` PLUS a per-run
//     `X-Skill-Run-Signature: sha256=<hmac>` header. The HMAC is computed
//     over the runId using the `completion_hmac_secret` shipped in the
//     run_skill envelope. A leaked API_AUTH_SECRET alone cannot forge a
//     completion for a different tenant.
//   - This callback ONLY fires for skill_run invocations (those carrying
//     `skill_run_id` + `completion_hmac_secret` in the payload). Chat-turn
//     invocations use the chat-finalize callback when Event-mode dispatch
//     supplies one; otherwise this remains a no-op for direct debug calls.
// ---------------------------------------------------------------------------

export interface SkillRunContext {
  /** skill_runs.id — the row the callback updates. */
  runId: string;
  /** Per-run HMAC secret shipped in the run_skill envelope. */
  hmacSecret: string;
}

export type CompletionStatus =
  | "complete"
  | "failed"
  | "cancelled"
  | "cost_bounded_error";

export interface CompletionCallbackArgs {
  secrets: SecretsSnapshot;
  identity: IdentitySnapshot;
  /**
   * Skill-run identifiers. `null` means this is a chat-turn invocation —
   * postCompletion is a no-op (chat-agent-invoke owns turn completion).
   */
  runContext: SkillRunContext | null;
  result:
    | { status: "ok"; runResult: RunAgentLoopResult; latencyMs: number }
    | { status: "error"; error: unknown; latencyMs: number };
  fetchImpl: typeof fetch;
  /** Per-attempt timeout (default 15s). Bounds the postCompletion stall. */
  attemptTimeoutMs?: number;
}

export class CompletionCallbackAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionCallbackAuthError";
  }
}

const COMPLETION_RETRY_DELAYS_MS = [200, 600, 1500] as const;
const DEFAULT_COMPLETION_ATTEMPT_TIMEOUT_MS = 15_000;

/**
 * Map the agent loop's success/error result onto the completion endpoint's
 * status enum.
 */
function asCompletionStatus(result: CompletionCallbackArgs["result"]): {
  status: CompletionStatus;
  failureReason: string | null;
} {
  if (result.status === "ok") {
    return { status: "complete", failureReason: null };
  }
  const message =
    result.error instanceof Error ? result.error.message : String(result.error);
  return { status: "failed", failureReason: message.slice(0, 500) };
}

/**
 * Per-run HMAC of the runId. Mirrors run_skill_dispatch.py's signature
 * computation so the server's `verifyCompletionHmac` accepts it.
 */
function computeCompletionHmac(runId: string, hmacSecret: string): string {
  // `crypto` is dynamically required so test-only paths that never call this
  // function don't have to load the module.
  const { createHmac } = require("node:crypto") as {
    createHmac: typeof import("node:crypto").createHmac;
  };
  return createHmac("sha256", hmacSecret).update(runId).digest("hex");
}

/**
 * POST `/api/skills/complete` with the snapshotted secret + per-run HMAC.
 *
 * 401 surfaces as `CompletionCallbackAuthError`
 * (per `feedback_avoid_fire_and_forget_lambda_invokes`) so a runtime-side
 * auth mismatch fails the invocation loudly instead of silently dropping
 * observability data. Other failures retry with bounded backoff. Each
 * attempt is bounded by `attemptTimeoutMs` (default 15s) so a hung
 * upstream cannot stall the Lambda for the full retry window.
 */
export async function postCompletion(
  args: CompletionCallbackArgs,
): Promise<void> {
  const { secrets, identity, runContext, result, fetchImpl } = args;
  const attemptTimeoutMs =
    args.attemptTimeoutMs ?? DEFAULT_COMPLETION_ATTEMPT_TIMEOUT_MS;

  if (!runContext) {
    // Chat-turn invocation — chat-finalize owns the writeback when configured.
    // Direct debug invocations do not carry skill-run ids, so there is nothing
    // for the skill completion endpoint to update.
    return;
  }
  if (!secrets.apiUrl || !secrets.apiAuthSecret) {
    logStructured({
      level: "warn",
      event: "completion_callback_disabled",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
      reason: "missing_secret_or_url",
    });
    return;
  }
  // Refuse to send the bearer over plaintext HTTP. localhost / dev rigs that
  // intentionally use http should override THINKWORK_API_URL with https.
  let parsedApiUrl: URL;
  try {
    parsedApiUrl = new URL(secrets.apiUrl);
  } catch {
    logStructured({
      level: "error",
      event: "completion_callback_invalid_url",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
    });
    return;
  }
  if (parsedApiUrl.protocol !== "https:") {
    logStructured({
      level: "error",
      event: "completion_callback_insecure_url",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
      protocol: parsedApiUrl.protocol,
    });
    return;
  }

  const url = `${secrets.apiUrl.replace(/\/$/, "")}/api/skills/complete`;
  const { status, failureReason } = asCompletionStatus(result);
  const body = JSON.stringify({
    runId: runContext.runId,
    tenantId: identity.tenantId,
    status,
    ...(failureReason !== null ? { failureReason } : {}),
  });
  const signature = computeCompletionHmac(
    runContext.runId,
    runContext.hmacSecret,
  );

  const totalAttempts = COMPLETION_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // The Authorization header value never appears in logStructured —
          // the per-key redactor strips it before any log emission.
          authorization: `Bearer ${secrets.apiAuthSecret}`,
          "x-skill-run-signature": `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
      if (response.status === 401) {
        // Don't log the response text — it can echo the bearer back.
        throw new CompletionCallbackAuthError(
          `Completion callback returned 401 for tenant ${identity.tenantId}.`,
        );
      }
      if (response.ok) return;
      logStructured({
        level: "warn",
        event: "completion_callback_non_2xx",
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        runId: runContext.runId,
        statusCode: response.status,
        attempt,
      });
      // 4xx other than 401 are terminal — the request body is malformed and
      // retrying won't change that. Bail without retrying.
      if (response.status >= 400 && response.status < 500) {
        return;
      }
    } catch (err) {
      if (err instanceof CompletionCallbackAuthError) {
        // 401 is terminal. Surface to the handler — no retry.
        throw err;
      }
      logStructured({
        level: "warn",
        event: "completion_callback_failed",
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        runId: runContext.runId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (attempt < totalAttempts - 1) {
      // Add ±25% jitter so N concurrent failed invocations don't thunder-herd
      // against the API at the same backoff timestamps.
      const baseDelay = COMPLETION_RETRY_DELAYS_MS[attempt] ?? 0;
      const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
      const delay = Math.max(0, Math.round(baseDelay + jitter));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // All retries exhausted — log a terminal-failure event so an operator sees
  // it. The 15-min skill-runs reconciler is the backstop.
  logStructured({
    level: "error",
    event: "completion_callback_exhausted",
    tenantId: identity.tenantId,
    threadId: identity.threadId,
    runId: runContext.runId,
    attempts: totalAttempts,
  });
}

export interface FinalizeCallbackArgs {
  payload: Record<string, unknown>;
  identity: IdentitySnapshot;
  systemPrompt?: string;
  result:
    | { status: "ok"; runResult: RunAgentLoopResult; latencyMs: number }
    | { status: "error"; error: unknown; latencyMs: number };
  fetchImpl: typeof fetch;
  attemptTimeoutMs?: number;
}

function usageNumber(usage: unknown, ...keys: string[]): number {
  if (!usage || typeof usage !== "object") return 0;
  const obj = usage as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function buildFinalizeBody(
  args: FinalizeCallbackArgs,
): Record<string, unknown> {
  const { payload, identity, result } = args;
  const runResult = result.status === "ok" ? result.runResult : null;
  const usage = runResult?.usage;
  const toolCosts =
    runResult?.toolCosts ??
    runResult?.toolInvocations.flatMap((invocation) =>
      collectToolCosts(invocation.result),
    ) ??
    [];
  const errorMessage =
    result.status === "error"
      ? result.error instanceof Error
        ? result.error.message
        : String(result.error)
      : undefined;

  return {
    thread_turn_id: asString(payload.thread_turn_id),
    tenant_id: identity.tenantId,
    agent_id: identity.agentId,
    thread_id: identity.threadId,
    trace_id: asString(payload.trace_id) || undefined,
    user_message: asString(payload.message),
    agent_model: runResult?.modelId || asString(payload.model) || null,
    runtime_type: "pi",
    composed_system_prompt: args.systemPrompt || null,
    agent_slug: asString(payload.instance_id) || null,
    agent_name: asString(payload.agent_name) || null,
    duration_ms: result.latencyMs,
    status: result.status === "ok" ? "completed" : "failed",
    error_message: errorMessage,
    computer_id: asString(payload.computer_id) || null,
    computer_task_id: asString(payload.computer_task_id) || null,
    usage: {
      model: runResult?.modelId || asString(payload.model) || null,
      input_tokens: usageNumber(usage, "inputTokens", "input", "prompt_tokens"),
      output_tokens: usageNumber(
        usage,
        "outputTokens",
        "output",
        "completion_tokens",
      ),
      cached_read_tokens: usageNumber(
        usage,
        "cachedReadTokens",
        "cacheRead",
        "cached_read_tokens",
      ),
    },
    response: runResult
      ? {
          composed_system_prompt: args.systemPrompt || null,
          content: runResult.content,
          runtime: "pi",
          model: runResult.modelId,
          usage: runResult.usage,
          tools_called: runResult.toolsCalled,
          tool_invocations: runResult.toolInvocations,
          tool_costs: toolCosts,
          hindsight_usage: [],
        }
      : {
          composed_system_prompt: args.systemPrompt || null,
          runtime: "pi",
          tools_called: [],
          tool_invocations: [],
          hindsight_usage: [],
        },
  };
}

function callbackUrlAllowed(
  callbackUrl: string,
  apiUrl: string,
): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocalhost) {
    return { ok: false, reason: "insecure-url" };
  }

  const trimmedApiUrl = apiUrl.trim();
  if (!trimmedApiUrl) return { ok: false, reason: "missing-api-url" };

  try {
    const parsedApiUrl = new URL(trimmedApiUrl);
    const apiIsLocalhost =
      parsedApiUrl.hostname === "localhost" ||
      parsedApiUrl.hostname === "127.0.0.1";
    if (parsedApiUrl.protocol !== "https:" && !apiIsLocalhost) {
      return { ok: false, reason: "insecure-api-url" };
    }
    if (!apiIsLocalhost && parsed.origin !== parsedApiUrl.origin) {
      return { ok: false, reason: "origin-mismatch" };
    }
  } catch {
    return { ok: false, reason: "invalid-api-url" };
  }

  return { ok: true };
}

function isFinalizeCallbackConfigured(
  payload: Record<string, unknown>,
): boolean {
  return Boolean(
    asString(payload.finalize_callback_url) &&
      asString(payload.finalize_callback_secret) &&
      asString(payload.thread_turn_id),
  );
}

export async function postFinalizeCallback(
  args: FinalizeCallbackArgs,
): Promise<boolean> {
  const { payload, identity, fetchImpl } = args;
  const callbackUrl = asString(payload.finalize_callback_url);
  const callbackSecret = asString(payload.finalize_callback_secret);
  const threadTurnId = asString(payload.thread_turn_id);
  const attemptTimeoutMs =
    args.attemptTimeoutMs ?? DEFAULT_COMPLETION_ATTEMPT_TIMEOUT_MS;

  if (!callbackUrl || !callbackSecret || !threadTurnId) return false;

  const urlCheck = callbackUrlAllowed(
    callbackUrl,
    asString(payload.thinkwork_api_url),
  );
  if (!urlCheck.ok) {
    logStructured({
      level: "error",
      event:
        urlCheck.reason === "invalid-url"
          ? "finalize_callback_invalid_url"
          : "finalize_callback_rejected_url",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
      reason: urlCheck.reason,
    });
    return false;
  }

  const body = JSON.stringify(buildFinalizeBody(args));
  const totalAttempts = COMPLETION_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(callbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${callbackSecret}`,
        },
        body,
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
      if (response.ok) return true;
      logStructured({
        level: response.status >= 500 ? "warn" : "error",
        event: "finalize_callback_non_2xx",
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        statusCode: response.status,
        attempt,
      });
      if (response.status >= 400 && response.status < 500) return false;
    } catch (err) {
      logStructured({
        level: "warn",
        event: "finalize_callback_failed",
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (attempt < totalAttempts - 1) {
      const baseDelay = COMPLETION_RETRY_DELAYS_MS[attempt] ?? 0;
      const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
      const delay = Math.max(0, Math.round(baseDelay + jitter));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  logStructured({
    level: "error",
    event: "finalize_callback_exhausted",
    tenantId: identity.tenantId,
    threadId: identity.threadId,
    threadTurnId,
    attempts: totalAttempts,
  });
  return false;
}

/**
 * Pull the run_skill envelope out of the invocation payload, if present.
 * Returns null for chat-turn invocations (where these fields aren't set).
 * Both fields must be present and non-empty for the callback to fire.
 */
export function extractSkillRunContext(
  payload: Record<string, unknown>,
): SkillRunContext | null {
  const runId = asString(payload.skill_run_id);
  const hmacSecret = asString(payload.completion_hmac_secret);
  if (!runId || !hmacSecret) return null;
  return { runId, hmacSecret };
}

// ---------------------------------------------------------------------------
// /invocations entry — the Lambda Web Adapter routes POSTs here.
// ---------------------------------------------------------------------------

export interface HandleInvocationArgs {
  payload: Record<string, unknown>;
  deps?: Partial<HandlerDependencies>;
}

export interface HandleInvocationResult {
  statusCode: number;
  body: Record<string, unknown>;
}

/**
 * The trusted handler entry point. Stateless w.r.t. module-load globals;
 * tests call this directly with a synthesized payload + injected deps.
 */
export async function handleInvocation(
  args: HandleInvocationArgs,
): Promise<HandleInvocationResult> {
  const deps: HandlerDependencies = { ...defaultDependencies, ...args.deps };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const runLoop = deps.runAgentLoop ?? runAgentLoop;
  const bootstrap = deps.bootstrapWorkspaceImpl ?? bootstrapWorkspace;
  const discoverSkills =
    deps.discoverWorkspaceSkillsImpl ?? discoverWorkspaceSkills;
  const sessionStoreFactory =
    deps.sessionStoreFactory ?? ((opts) => new AuroraSessionStore(opts));

  const start = Date.now();

  // Snapshot identity + secrets + env BEFORE constructing tools so
  // anything downstream sees a frozen view.
  let identity: IdentitySnapshot;
  try {
    identity = snapshotIdentity(args.payload);
  } catch (err) {
    if (err instanceof InvocationValidationError) {
      logStructured({
        level: "warn",
        event: "invocation_rejected",
        error: err.message,
        statusCode: err.statusCode,
      });
      return {
        statusCode: err.statusCode,
        body: { error: err.message, runtime: "pi" },
      };
    }
    throw err;
  }
  const secrets = snapshotSecrets(args.payload);
  const env = snapshotRuntimeEnv();

  const userMessage = asString(args.payload.message);
  if (!userMessage) {
    logStructured({
      level: "warn",
      event: "invocation_rejected",
      tenantId: identity.tenantId,
      error: "empty_message",
    });
    return {
      statusCode: 400,
      body: {
        error: "Pi invocation requires a non-empty `message`.",
        runtime: "pi",
      },
    };
  }

  // Workspace S3 sync — required for tenant isolation when WORKSPACE_BUCKET
  // is configured. Lambda warm containers persist `/tmp/workspace` across
  // invocations, so a turn that skips the per-tenant sync (because
  // tenant_slug or instance_id is missing from the payload) would discover
  // the prior tenant's SKILL.md files and leak them into the system prompt.
  // Fail-closed: if the bucket is configured but the payload doesn't carry
  // the slugs, refuse the invocation.
  if (env.workspaceBucket) {
    if (!identity.tenantSlug || !identity.agentSlug) {
      logStructured({
        level: "error",
        event: "workspace_sync_required_but_unscoped",
        tenantId: identity.tenantId,
        agentId: identity.agentId,
        hasTenantSlug: Boolean(identity.tenantSlug),
        hasAgentSlug: Boolean(identity.agentSlug),
      });
      return {
        statusCode: 400,
        body: {
          error:
            "Pi invocation requires `tenant_slug` and `instance_id` (agent slug) when WORKSPACE_BUCKET is configured. Refusing to proceed against a potentially cross-tenant /tmp/workspace.",
          runtime: "pi",
        },
      };
    }
    try {
      const s3 = deps.s3ClientFactory(env.awsRegion);
      await bootstrap(
        identity.tenantSlug,
        identity.agentSlug,
        env.workspaceDir,
        s3,
        env.workspaceBucket,
        {
          workspacePrefix: asString(args.payload.rendered_workspace_prefix),
        },
      );
    } catch (err) {
      logStructured({
        level: "warn",
        event: "workspace_bootstrap_failed",
        tenantId: identity.tenantId,
        agentSlug: identity.agentSlug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const workspaceSkills = await discoverSkills(env.workspaceDir);

  // Plan §006 U4 — read mcp.json from the bootstrapped workspace. A
  // malformed file aborts the invocation with a structured 500 (same
  // path tool-assembly failures take) so the operator sees the parse
  // error in the agent's first turn instead of silently disabling
  // directTools validation.
  let mcpJsonConfig: McpJsonConfig;
  try {
    mcpJsonConfig = await readMcpJson(env.workspaceDir);
  } catch (err) {
    if (err instanceof McpJsonError) {
      logStructured({
        level: "error",
        event: "mcp_json_invalid",
        tenantId: identity.tenantId,
        agentSlug: identity.agentSlug,
        error: err.message,
      });
      return {
        statusCode: 500,
        body: {
          error: err.message,
          runtime: "pi",
        },
      };
    }
    throw err;
  }
  const mcpRegistry = new McpToolRegistry();

  const agentCoreClient = deps.agentCoreClientFactory();

  // SessionStore — instantiate so failures surface here, BEFORE the agent
  // loop spends LLM tokens. The current placeholder dispatch reads no
  // session blob (Pi's session.prompt() would; the in-process Agent
  // loop is stateless across invocations beyond messages_history).
  if (env.dbClusterArn && env.dbSecretArn) {
    try {
      sessionStoreFactory({
        tenantId: identity.tenantId,
        agentId: identity.agentId,
        clusterArn: env.dbClusterArn,
        secretArn: env.dbSecretArn,
        database: env.dbName,
      });
    } catch (err) {
      logStructured({
        level: "warn",
        event: "session_store_init_failed",
        tenantId: identity.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Non-fatal for U9 — the placeholder loop doesn't read session blobs.
    }
  }

  // Allocate the per-invocation cleanup queue here (the same array the
  // handler's `finally` block drains). The MCP connect factory and tool
  // builders share this reference, so transport teardown closures land in
  // the array we actually drain — not a private array owned by the
  // factory. This was a real defect in an earlier draft that the multi-
  // reviewer pass caught (correctness + reliability + maintainability +
  // adversarial + agent-native + kieran-typescript all flagged it).
  const cleanup: Array<() => Promise<void>> = [];

  // U16 — Allocate the per-invocation HandleStore here (was previously
  // created inside assembleTools). Both the scrubbing fetch
  // (createScrubbingFetch below) and the MCP tool builder
  // (assembleTools → buildMcpTools) need to share this same instance
  // so the egress fetch resolves the handle the build minted. The
  // handler's `finally` block already calls `bundle.handleStore.clear()`
  // which now operates on the same store.
  const handleStore = new HandleStore();

  // U16 — Egress fetch interceptor. Swaps `Authorization: Handle <uuid>`
  // for `Bearer <bearer>` at HTTP-call time and scrubs response bodies
  // for bearer-shaped strings + the literal active bearer. Production
  // path; tests inject `connectMcpServerFactory` to bypass entirely.
  const scrubbingFetch = createScrubbingFetch({ handleStore });

  const connectMcpServer =
    deps.connectMcpServerFactory ??
    createConnectMcpServer({ cleanup, fetch: scrubbingFetch });

  // Build tools last so any setup failure above short-circuits before
  // we touch the HandleStore.
  let bundle: AssembledToolBundle;
  try {
    bundle = await assembleTools({
      payload: args.payload,
      identity,
      env,
      agentCoreClient,
      workspaceSkills,
      connectMcpServer,
      sessionStoreFactory,
      cleanup,
      handleStore,
      mcpJsonConfig,
      mcpRegistry,
    });
  } catch (err) {
    // U16 — assembleTools may have minted handles into `handleStore`
    // before failing (e.g., MCP transport opened then listTools timed
    // out). The runLoop's finally block is unreachable on this path, so
    // clear the store + drain any partial cleanup closures HERE to
    // honor the U7 invariant: `try { … } finally { handleStore.clear() }`
    // on every handleInvocation exit path.
    handleStore.clear();
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch (cleanupErr) {
        logStructured({
          level: "warn",
          event: "cleanup_failed",
          tenantId: identity.tenantId,
          error:
            cleanupErr instanceof Error
              ? cleanupErr.message
              : String(cleanupErr),
        });
      }
    }
    logStructured({
      level: "error",
      event: "tool_assembly_failed",
      tenantId: identity.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      statusCode: 500,
      body: {
        error: err instanceof Error ? err.message : "Pi tool assembly failed.",
        runtime: "pi",
      },
    };
  }

  // Run the agent loop inside try/finally so the HandleStore is cleared
  // even if the LLM throws or a tool raises.
  let runResult: RunAgentLoopResult | undefined;
  let runError: unknown;
  const stageAttachments =
    deps.stageMessageAttachmentsImpl ?? stageMessageAttachments;
  const stagedAttachments = await stageAttachments({
    attachments: args.payload.message_attachments,
    workspaceBucket: env.workspaceBucket,
    expectedTenantId: identity.tenantId,
    expectedThreadId: identity.threadId,
    s3Client: deps.s3ClientFactory(env.awsRegion),
    logger: (event, details) =>
      logStructured({
        level: "warn",
        event,
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        ...details,
      }),
  });
  const attachmentPreamble = formatMessageAttachmentsPreamble(
    stagedAttachments.staged,
  );
  const systemPromptBase = await composeSystemPrompt({
    payload: args.payload,
    workspaceDir: env.workspaceDir,
    availableToolNames: bundle.tools.map((tool) => tool.name),
    workspaceSkillsBlock: formatWorkspaceSkills(workspaceSkills),
  });
  const systemPrompt = attachmentPreamble
    ? `${systemPromptBase}\n\n---\n\n${attachmentPreamble}`
    : systemPromptBase;
  const fileReadTool = buildFileReadTool(stagedAttachments.staged);
  if (fileReadTool) {
    bundle.tools.push(fileReadTool);
  }
  try {
    // The current invocation's model id is what pi-ai's Agent will use
    // to serialize history → Bedrock for THIS turn. We use the same id on
    // synthesized AssistantMessage history entries so the metadata is
    // self-consistent even though pi-ai doesn't actually read those
    // fields during serialization.
    const currentModelId =
      typeof args.payload.model === "string" && args.payload.model.trim()
        ? args.payload.model.trim()
        : "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
    runResult = await runLoop({
      message: userMessage,
      history: normalizeHistory(args.payload.messages_history, currentModelId),
      systemPrompt,
      tools: bundle.tools,
      modelId: args.payload.model,
      threadId: identity.threadId,
      gitSha: env.gitSha,
      identity,
    });
  } catch (err) {
    runError = err;
  } finally {
    bundle.handleStore.clear();
    for (const fn of bundle.cleanup.reverse()) {
      try {
        await fn();
      } catch (err) {
        logStructured({
          level: "warn",
          event: "cleanup_failed",
          tenantId: identity.tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    try {
      await cleanupMessageAttachments(stagedAttachments.turnDir);
    } catch (err) {
      logStructured({
        level: "warn",
        event: "message_attachment_cleanup_failed",
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    deps.onHandlerComplete?.(bundle);
  }

  const latencyMs = Date.now() - start;

  // Skill-run invocations carry a runId + HMAC; chat-turn invocations don't.
  // Chat turns use the finalize callback when configured.
  const runContext = extractSkillRunContext(args.payload);

  if (runError !== undefined || !runResult) {
    if (isFinalizeCallbackConfigured(args.payload)) {
      const finalized = await postFinalizeCallback({
        payload: args.payload,
        identity,
        systemPrompt,
        result: { status: "error", error: runError, latencyMs },
        fetchImpl,
      });
      if (finalized) {
        return {
          statusCode: 200,
          body: { ok: true, finalize_dispatched: true, runtime: "pi" },
        };
      }
    }
    // Try to fire the completion callback (status=error). 401 from the
    // callback throws — that's an auth-config bug we want loud, not a
    // silent failure on top of a turn failure.
    try {
      await postCompletion({
        secrets,
        identity,
        runContext,
        result: { status: "error", error: runError, latencyMs },
        fetchImpl,
      });
    } catch (cbErr) {
      logStructured({
        level: "error",
        event: "completion_callback_threw",
        tenantId: identity.tenantId,
        error: cbErr instanceof Error ? cbErr.message : String(cbErr),
      });
    }
    return {
      statusCode: 500,
      body: {
        error: runError instanceof Error ? runError.message : String(runError),
        runtime: "pi",
      },
    };
  }

  // End-of-turn auto-retain — fire-and-forget invoke of the memory-retain
  // Lambda with the per-turn transcript. The receiving Lambda routes through
  // the API's normalized memory layer (Hindsight or AgentCore depending on
  // engine). Awaited so the Event invoke is queued before HTTP response —
  // Lambda Web Adapter's in-flight Promise lifecycle is undocumented in our
  // institutional record, so we trade ~tens of ms for guaranteed delivery.
  // Failures are logged but never bubble to the user (retain is best-effort).
  const retainOutcome = await retainConversation({
    payload: args.payload as RetainPayloadInput,
    identity,
    env,
    assistantContent: runResult.content,
    lambdaClient: deps.lambdaClientFactory(env.awsRegion),
  });
  if (retainOutcome.retained) {
    logStructured({
      level: "info",
      event: "memory_retain_dispatched",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
    });
  } else if (retainOutcome.error) {
    logStructured({
      level: "warn",
      event: "memory_retain_failed",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
      error: retainOutcome.error,
    });
  }

  if (isFinalizeCallbackConfigured(args.payload)) {
    const finalized = await postFinalizeCallback({
      payload: args.payload,
      identity,
      systemPrompt,
      result: { status: "ok", runResult, latencyMs },
      fetchImpl,
    });
    if (finalized) {
      return {
        statusCode: 200,
        body: { ok: true, finalize_dispatched: true, runtime: "pi" },
      };
    }
    return {
      statusCode: 500,
      body: {
        error: "Pi finalize callback failed; retrying invocation.",
        runtime: "pi",
      },
    };
  }

  await postCompletion({
    secrets,
    identity,
    runContext,
    result: { status: "ok", runResult, latencyMs },
    fetchImpl,
  });

  // The placeholder dispatch in U9 has no Hindsight retain pipeline yet;
  // U16's worker integration will populate this. Pass an empty array so
  // chat-agent-invoke's `responseData?.hindsight_usage || invokeResult.hindsight_usage || []`
  // fallback (chat-agent-invoke.ts:629) keeps working.
  const hindsightUsage: unknown[] = [];

  const responseBody: InvocationResponse = {
    runtime: "pi",
    composed_system_prompt: systemPrompt,
    pi_usage: runResult.usage,
    pi_retain: retainOutcome.error
      ? { retained: retainOutcome.retained, error: retainOutcome.error }
      : { retained: retainOutcome.retained },
    // Plan §006 U4 — pin the proxy substrate. Always present as a boolean
    // so the smoke can assert the field shape regardless of whether the
    // current scenario carries MCP configs.
    mcp_proxy_registered: bundle.mcpProxyRegistered,
    tools_called: runResult.toolsCalled,
    tool_invocations: runResult.toolInvocations,
    hindsight_usage: hindsightUsage,
    response: {
      role: "assistant",
      content: runResult.content,
      runtime: "pi",
      model: runResult.modelId,
      usage: runResult.usage,
      tools_called: runResult.toolsCalled,
      tool_invocations: runResult.toolInvocations,
      tool_costs:
        runResult.toolCosts ??
        runResult.toolInvocations.flatMap((invocation) =>
          collectToolCosts(invocation.result),
        ),
      hindsight_usage: hindsightUsage,
    },
  };
  responseBody.tool_costs = responseBody.response.tool_costs;
  return {
    statusCode: 200,
    body: responseBody as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// HTTP plumbing — only `/ping` and `/invocations` matter to the runtime.
// ---------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown) {
  const encoded = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(encoded),
  });
  res.end(encoded);
}

/**
 * Lambda's request payload is capped at 6MB; AgentCore's runtime caps at a
 * comparable size. Honour that here so a malformed/oversized request fails
 * fast with 413 rather than buffering arbitrary bytes into memory.
 */
const MAX_INVOCATION_BODY_BYTES = 6 * 1024 * 1024;

class PayloadTooLargeError extends Error {
  constructor() {
    super("invocation payload exceeded MAX_INVOCATION_BODY_BYTES");
    this.name = "PayloadTooLargeError";
  }
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_INVOCATION_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleHttpInvocation(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  let body: string;
  try {
    body = await readBody(req);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      sendJson(res, 413, { error: err.message, runtime: "pi" });
      return;
    }
    sendJson(res, 400, {
      error: err instanceof Error ? err.message : "request read failed",
      runtime: "pi",
    });
    return;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: "invalid json", runtime: "pi" });
    return;
  }
  try {
    const result = await handleInvocation({ payload });
    sendJson(res, result.statusCode, result.body);
  } catch (err) {
    logStructured({
      level: "error",
      event: "invocation_unhandled",
      error: err instanceof Error ? err.message : String(err),
    });
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
      runtime: "pi",
    });
  }
}

export function createServer() {
  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/ping") {
      sendJson(res, 200, {
        status: "Healthy",
        runtime: "pi",
        time_of_last_update: Math.floor(Date.now() / 1000),
      });
      return;
    }
    // Two transport paths route here:
    //   1. AgentCore runtime direct-invoke (`InvokeAgentRuntime`) → POST
    //      /invocations
    //   2. Lambda invoke (`lambda.Invoke` from chat-agent-invoke) bridged
    //      through AWS Lambda Web Adapter → POST /  (the LWA default
    //      when there's no API Gateway path on the event)
    // Accept POST regardless of path so chat-agent-invoke's existing
    // dispatcher (which goes via Lambda) hits the same handler as direct
    // runtime invokes. Without this, every Lambda-mediated invocation
    // returns `{"error":"not found","runtime":"pi"}` even though the
    // payload was correct.
    if (req.method === "POST") {
      void handleHttpInvocation(req, res);
      return;
    }
    sendJson(res, 404, { error: "not found", runtime: "pi" });
  });
}

if (process.env.NODE_ENV !== "test") {
  createServer().listen(PORT, "0.0.0.0", () => {
    // Use logStructured so prod logs are JSON-line on day one.
    logStructured({
      level: "info",
      event: "server_listening",
      port: PORT,
    });
  });
}
