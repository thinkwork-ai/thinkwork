import {
  getConfig,
  getApiAuthSecret,
  getAppsyncApiKey,
} from "@thinkwork/runtime-config";
import { classifyMcpToolAccess } from "@thinkwork/evals-core";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  resolveAgentRuntimeConfig,
  type AgentRuntimeConfig,
} from "../resolve-agent-runtime-config.js";
import { resolveRuntimeFunctionName } from "../resolve-runtime-function-name.js";

// Import from the leaf module (used internally below) and re-export so
// callers that only need the id (e.g. skill-eval-run.ts) can import it
// WITHOUT dragging this module's heavy resolve-agent-runtime-config →
// oauth-token (barrel schema) chain.
import { DEFAULT_EVAL_MODEL_ID } from "./eval-defaults.js";
export { DEFAULT_EVAL_MODEL_ID };
export const DEFAULT_EVAL_AGENTCORE_INVOKE_TIMEOUT_MS = 180_000;
export const DEFAULT_EVAL_AGENTCORE_MAX_ATTEMPTS = 3;
export const DEFAULT_EVAL_MAX_TOKENS = 1_024;

const lambdaClient = new LambdaClient({});

function appsyncEndpoint(): string {
  return getConfig("APPSYNC_ENDPOINT", "");
}
function workspaceBucket(): string {
  return getConfig("WORKSPACE_BUCKET", "");
}
function thinkworkApiUrl(): string {
  return getConfig("THINKWORK_API_URL") || process.env.MCP_BASE_URL || "";
}
function hindsightEndpoint(): string {
  return getConfig("HINDSIGHT_ENDPOINT", "");
}

export function evalModelId(model: string | null | undefined): string {
  return model?.trim() || DEFAULT_EVAL_MODEL_ID;
}

export function evalAgentCoreInvokeTimeoutMs(
  value = process.env.EVAL_AGENTCORE_INVOKE_TIMEOUT_MS,
): number {
  const parsed = Number(value ?? DEFAULT_EVAL_AGENTCORE_INVOKE_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EVAL_AGENTCORE_INVOKE_TIMEOUT_MS;
  }
  return parsed;
}

export function evalMaxTokens(value = process.env.EVAL_MAX_TOKENS): number {
  const parsed = Number(value ?? DEFAULT_EVAL_MAX_TOKENS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EVAL_MAX_TOKENS;
  }
  return Math.floor(parsed);
}

export function evalAgentCoreAttemptSessionId(
  sessionId: string,
  attempt: number,
): string {
  return attempt <= 1 ? sessionId : `${sessionId}-retry-${attempt}`;
}

export class AgentCoreEvalInvocationTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`AgentCore eval invocation exceeded ${timeoutMs}ms response budget`);
    this.name = "AgentCoreEvalInvocationTimeoutError";
  }
}

export class AgentCoreEvalEmptyResponseError extends Error {
  constructor() {
    super("AgentCore returned an empty eval response");
    this.name = "AgentCoreEvalEmptyResponseError";
  }
}

export function extractAgentCoreResponseText(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return String(data);

  const obj = data as Record<string, any>;
  if (Array.isArray(obj.choices) && obj.choices[0]?.message?.content) {
    return obj.choices[0].message.content;
  }
  if (typeof obj.response_text === "string") return obj.response_text;
  if (typeof obj.responseText === "string") return obj.responseText;
  if (typeof obj.content === "string") return obj.content;
  if (typeof obj.response === "string") return obj.response;
  if (typeof obj.output === "string") return obj.output;
  if (typeof obj.text === "string") return obj.text;
  if (obj.response && typeof obj.response === "object") {
    return extractAgentCoreResponseText(obj.response);
  }

  return JSON.stringify(data);
}

/**
 * Agent-turn token usage extracted from the runtime's eval response
 * (Eval Profiles U5). The worker prices it against the run's snapshot
 * model; tokens without resolved catalog pricing record with a null
 * cost — never zero.
 */
export interface EvalAgentUsage {
  inputTokens: number;
  outputTokens: number;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Extract agent-turn token usage from a runtime usage object. Accepts
 * the Pi runtime's pi-ai `Usage` shape (`{ input, output, ... }` — what
 * `pi_usage` / `response.usage` carry today) and the normalized
 * `{ inputTokens, outputTokens }` shape. Returns undefined when the
 * envelope has no recognizable usage (older runtime images) — the
 * telemetry columns then stay null and the run summary marks cost
 * partial rather than recording a false zero (R6).
 */
export function extractAgentCoreUsage(
  data: unknown,
): EvalAgentUsage | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const usage = data as Record<string, unknown>;
  const inputTokens =
    finiteNonNegative(usage.input) ?? finiteNonNegative(usage.inputTokens);
  const outputTokens =
    finiteNonNegative(usage.output) ?? finiteNonNegative(usage.outputTokens);
  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }
  return { inputTokens, outputTokens };
}

/**
 * Replay history row shape (U8): identical to the `messages_history`
 * rows chat-agent-invoke ships to the Pi runtime, which normalizes them
 * via `normalizeHistory` (role 'user' | 'assistant' + non-empty string
 * content; everything else is dropped).
 */
export interface EvalReplayHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * A single operator OVERRIDE for an MCP tool on replay (Trust Core U14).
 * The default behavior is heuristic (read-shaped tools run, write-shaped
 * tools are blocked — classifyMcpToolAccess); an override flips that
 * decision for one (server, tool):
 *   - mode "allow" — force-allow a tool the heuristic would block (e.g. a
 *     trusted write).
 *   - mode "block" — force-block a tool the heuristic would allow (e.g.
 *     suppress a read).
 * The email/web kill-list stays blocked regardless of any override.
 */
export interface EvalReplayToolOverride {
  serverName: string;
  toolName: string;
  mode: "allow" | "block";
}

/**
 * Back-compat alias for the U13 name. The shape now carries `mode`; older
 * call sites that constructed `{ serverName, toolName }` are gone, but the
 * exported name is retained to avoid a churny rename across importers.
 *
 * @deprecated Use {@link EvalReplayToolOverride}.
 */
export type EvalReplayAllowedTool = EvalReplayToolOverride;

/**
 * Select the MCP tools that run on replay (Trust Core U14).
 *
 * New default-ALLOW model: for each of the agent's resolved MCP servers,
 * the effective tool set is its `availableTools` filtered to
 *   { t | (classify(t) === "read" OR force-allowed(server, t))
 *         AND NOT force-blocked(server, t) }
 * where classify is the name heuristic (classifyMcpToolAccess) and the
 * force-allow/force-block sets come from the operator overrides. The
 * surviving tools become the server's `tools` (the runtime's per-server
 * toolWhitelist).
 *
 *   - Empty overrides + servers that expose read tools → those reads run
 *     automatically (the new default; no operator setup needed).
 *   - A server whose effective set is empty is dropped entirely.
 *   - A server with NO cached `availableTools` can't be classified, so it
 *     contributes ONLY its force-allowed tools (none → server dropped).
 *   - No servers survive → `undefined`, matching the pre-U13
 *     `mcp_configs: undefined` behavior.
 */
export function selectReplayMcpTools(
  mcpConfigs: AgentRuntimeConfig["mcpConfigs"],
  overrides: EvalReplayToolOverride[] | undefined,
): AgentRuntimeConfig["mcpConfigs"] | undefined {
  if (!mcpConfigs || mcpConfigs.length === 0) return undefined;

  // Index overrides by server → tool → mode. Last write wins per tool.
  const forceAllow = new Map<string, Set<string>>();
  const forceBlock = new Map<string, Set<string>>();
  for (const entry of overrides ?? []) {
    const server = entry.serverName?.trim();
    const tool = entry.toolName?.trim();
    if (!server || !tool) continue;
    const target = entry.mode === "block" ? forceBlock : forceAllow;
    const other = entry.mode === "block" ? forceAllow : forceBlock;
    const set = target.get(server) ?? new Set<string>();
    set.add(tool);
    target.set(server, set);
    // A tool can't be both force-allowed and force-blocked; the latest
    // override mode for it wins.
    other.get(server)?.delete(tool);
  }

  const selected = mcpConfigs
    .map((server) => {
      const allow = forceAllow.get(server.name) ?? new Set<string>();
      const block = forceBlock.get(server.name) ?? new Set<string>();
      const available = (server.availableTools ?? [])
        .map((t) => t.trim())
        .filter(Boolean);

      let tools: string[];
      if (available.length > 0) {
        // Classifiable server: read-shaped tools run by default; overrides
        // flip individual decisions.
        tools = available.filter((tool) => {
          if (block.has(tool)) return false;
          if (allow.has(tool)) return true;
          return classifyMcpToolAccess(tool) === "read";
        });
      } else {
        // Unclassifiable server (no cached tool list): include only its
        // force-allowed tools that aren't also force-blocked.
        tools = [...allow].filter((tool) => !block.has(tool));
      }

      if (tools.length === 0) return null;
      return { ...server, tools };
    })
    .filter((server): server is NonNullable<typeof server> => server !== null);

  return selected.length > 0 ? selected : undefined;
}

export function buildEvalAgentCorePayload(input: {
  tenantId: string;
  agentId: string;
  sessionId: string;
  message: string;
  model: string | null | undefined;
  systemPrompt: string | null | undefined;
  runtimeConfig: AgentRuntimeConfig;
  /**
   * Flagged-thread replay (U8): the recorded conversation strictly
   * BEFORE the flagged turn. Synthetic cases omit this (single-message
   * replay, history []).
   */
  messagesHistory?: EvalReplayHistoryMessage[];
  /**
   * Operator MCP tool overrides for replay (U14). Default-ALLOW: read-shaped
   * tools run automatically by name heuristic even with no overrides; each
   * override force-allows a blocked write or force-blocks an allowed read.
   */
  replayToolOverrides?: EvalReplayToolOverride[];
}): Record<string, unknown> {
  const runtimeConfig = input.runtimeConfig;
  const mcpConfigs = selectReplayMcpTools(
    runtimeConfig.mcpConfigs,
    input.replayToolOverrides,
  );

  return {
    tenant_id: input.tenantId,
    workspace_tenant_id: input.tenantId,
    assistant_id: input.agentId,
    thread_id: input.sessionId,
    trace_id: input.sessionId,
    message: input.message,
    messages_history: input.messagesHistory ?? [],
    eval_mode: true,
    eval_tools_enabled: false,
    use_memory: false,
    tenant_slug: runtimeConfig.tenantSlug || undefined,
    instance_id: runtimeConfig.agentSlug || undefined,
    agent_name: runtimeConfig.agentName,
    system_prompt:
      input.systemPrompt || runtimeConfig.agentSystemPrompt || undefined,
    human_name: runtimeConfig.humanName || undefined,
    workspace_bucket: workspaceBucket() || undefined,
    thinkwork_api_url: thinkworkApiUrl() || undefined,
    thinkwork_api_secret: getApiAuthSecret() || undefined,
    appsync_endpoint: appsyncEndpoint() || undefined,
    appsync_api_key: getAppsyncApiKey() || undefined,
    hindsight_endpoint: hindsightEndpoint() || undefined,
    // Side-effect kill list (U8 replay KTD, layer 1 of 2): eval
    // invocations must never carry outbound side-effect tool configs —
    // replaying a real flagged thread could otherwise send real email
    // or burn external API quota. The Pi server additionally gates
    // these extension registrations on eval_mode (layer 2), so a
    // regression here is still inert.
    web_search_config: undefined,
    web_extract_config: undefined,
    send_email_config: undefined,
    context_engine_enabled: false,
    context_engine_config: undefined,
    runtime_type: runtimeConfig.runtimeType,
    model: evalModelId(input.model),
    budget_monthly_cents: runtimeConfig.budgetMonthlyCents,
    budget_paused: runtimeConfig.budgetPaused,
    max_tokens: evalMaxTokens(),
    skills:
      runtimeConfig.skillsConfig.length > 0
        ? runtimeConfig.skillsConfig
        : undefined,
    trusted_skill_ids: runtimeConfig.skillsConfig.map((skill) => skill.skillId),
    knowledge_bases: runtimeConfig.knowledgeBasesConfig,
    trigger_channel: "eval",
    guardrail_config: runtimeConfig.guardrailConfig || undefined,
    // Read-only MCP tools on replay (U14): default-ALLOW read-shaped tools
    // by name heuristic, block write-shaped ones; operator overrides flip
    // individual decisions. Each surviving server carries its selected tools
    // as the runtime's per-server toolWhitelist; the email/web kill-list
    // above stays blocked. No servers/tools survive → undefined (the pre-U13
    // strip-everything default).
    mcp_configs: mcpConfigs,
    blocked_tools:
      runtimeConfig.blockedTools.length > 0
        ? runtimeConfig.blockedTools
        : undefined,
    browser_automation_enabled: false,
  };
}

export async function invokeAgentCoreForEval(input: {
  tenantId: string;
  agentId: string;
  sessionId: string;
  message: string;
  model: string | null | undefined;
  systemPrompt?: string | null;
  /** Flagged-thread replay history (U8) — see buildEvalAgentCorePayload. */
  messagesHistory?: EvalReplayHistoryMessage[];
  /** Operator MCP tool overrides for replay (U14). Default-allow heuristic. */
  replayToolOverrides?: EvalReplayToolOverride[];
}): Promise<{
  output: string;
  durationMs: number;
  /**
   * The composed system prompt the runtime ran against, captured from
   * the runtime's response (Pi's `composed_system_prompt` field). Null
   * when the runtime did not surface it (legacy Pi build, Strands
   * responses that pre-date this contract).
   */
  composedSystemPrompt: string | null;
  /**
   * Agent-turn token usage from the runtime's response (Pi's `pi_usage`
   * / `response.usage`, Eval Profiles U5). Undefined when the runtime
   * did not surface usage (older runtime image) — the worker then
   * records null telemetry and the run summary marks cost partial.
   */
  usage?: EvalAgentUsage;
}> {
  let lastError: unknown;
  for (
    let attempt = 1;
    attempt <= DEFAULT_EVAL_AGENTCORE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await invokeAgentCoreForEvalOnce({
        ...input,
        sessionId: evalAgentCoreAttemptSessionId(input.sessionId, attempt),
      });
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof AgentCoreEvalEmptyResponseError) ||
        attempt >= DEFAULT_EVAL_AGENTCORE_MAX_ATTEMPTS
      ) {
        throw error;
      }
      console.warn(
        `[eval-worker] AgentCore returned an empty eval response; retrying attempt ${attempt + 1}/${DEFAULT_EVAL_AGENTCORE_MAX_ATTEMPTS}`,
      );
    }
  }
  throw lastError;
}

async function invokeAgentCoreForEvalOnce(input: {
  tenantId: string;
  agentId: string;
  sessionId: string;
  message: string;
  model: string | null | undefined;
  systemPrompt?: string | null;
  messagesHistory?: EvalReplayHistoryMessage[];
  replayToolOverrides?: EvalReplayToolOverride[];
}): Promise<{
  output: string;
  durationMs: number;
  composedSystemPrompt: string | null;
  usage?: EvalAgentUsage;
}> {
  const runtimeConfig = await resolveAgentRuntimeConfig({
    tenantId: input.tenantId,
    agentId: input.agentId,
    thinkworkApiUrl: thinkworkApiUrl(),
    thinkworkApiSecret: getApiAuthSecret(),
    appsyncApiKey: getAppsyncApiKey(),
    logPrefix: "[eval-worker]",
  });
  const agentcoreFunctionName = resolveRuntimeFunctionName(
    runtimeConfig.runtimeType,
  );
  const invokePayload = buildEvalAgentCorePayload({
    ...input,
    systemPrompt: input.systemPrompt ?? null,
    runtimeConfig,
  });
  const lambdaEventPayload = JSON.stringify({
    requestContext: { http: { method: "POST", path: "/invocations" } },
    rawPath: "/invocations",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(invokePayload),
    isBase64Encoded: false,
  });

  const startedAt = Date.now();
  const timeoutMs = evalAgentCoreInvokeTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let invokeRes;
  try {
    invokeRes = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: agentcoreFunctionName,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(lambdaEventPayload),
      }),
      { abortSignal: controller.signal },
    );
  } catch (err) {
    if (controller.signal.aborted) {
      throw new AgentCoreEvalInvocationTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  const rawPayload = invokeRes.Payload
    ? new TextDecoder().decode(invokeRes.Payload)
    : "{}";

  if (invokeRes.FunctionError) {
    throw new Error(
      `AgentCore Lambda ${invokeRes.FunctionError}: ${rawPayload.slice(0, 500)}`,
    );
  }

  const adapterResp = JSON.parse(rawPayload) as Record<string, unknown>;
  const adapterStatus = (adapterResp.statusCode as number) || 200;
  const adapterBodyStr = (adapterResp.body as string) || rawPayload;
  if (adapterStatus < 200 || adapterStatus >= 300) {
    throw new Error(
      `AgentCore ${adapterStatus}: ${adapterBodyStr.slice(0, 500)}`,
    );
  }

  const invokeResult = JSON.parse(adapterBodyStr) as Record<string, unknown>;
  const responseData = invokeResult.response || invokeResult;
  const output = extractAgentCoreResponseText(responseData);
  if (!output || output === "{}") {
    throw new AgentCoreEvalEmptyResponseError();
  }

  const rawComposedPrompt = invokeResult.composed_system_prompt;
  const composedSystemPrompt =
    typeof rawComposedPrompt === "string" && rawComposedPrompt.length > 0
      ? rawComposedPrompt
      : null;

  // Agent-turn token usage (Eval Profiles U5): the Pi runtime ships the
  // turn's usage as `pi_usage` (and mirrors it on `response.usage`).
  // Envelopes without it (older runtime images) leave `usage` undefined
  // — the worker records null telemetry, never a fabricated zero.
  const responseUsage =
    responseData && typeof responseData === "object"
      ? (responseData as Record<string, unknown>).usage
      : undefined;
  const usage =
    extractAgentCoreUsage(invokeResult.pi_usage) ??
    extractAgentCoreUsage(responseUsage);

  return {
    output,
    durationMs: Date.now() - startedAt,
    composedSystemPrompt,
    ...(usage ? { usage } : {}),
  };
}
