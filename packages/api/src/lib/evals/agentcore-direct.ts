import {
  getConfig,
  getApiAuthSecret,
  getAppsyncApiKey,
} from "@thinkwork/runtime-config";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  resolveAgentRuntimeConfig,
  type AgentRuntimeConfig,
} from "../resolve-agent-runtime-config.js";
import { resolveRuntimeFunctionName } from "../resolve-runtime-function-name.js";

export const DEFAULT_EVAL_MODEL_ID = "moonshotai.kimi-k2.5";
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
 * A single read-only MCP tool an operator has allowlisted for replay
 * (Trust Core U13). Default-deny: replay carries an MCP server ONLY if at
 * least one of its tools appears here, and only the listed tools become
 * that server's toolWhitelist. Mutating tools and the email/web kill-list
 * stay blocked regardless of what's listed.
 */
export interface EvalReplayAllowedTool {
  serverName: string;
  toolName: string;
}

/**
 * Restrict the agent's resolved MCP servers to the operator's read-only
 * replay allowlist (Trust Core U13). Returns the subset of
 * `runtimeConfig.mcpConfigs` that has ≥1 allowlisted tool, with each
 * surviving entry's `tools` (the runtime's per-server toolWhitelist) set to
 * exactly the allowlisted tool names for that server.
 *
 * Default-deny is preserved by construction: an empty allowlist yields
 * `undefined` (no servers), matching the pre-U13 `mcp_configs: undefined`
 * behavior. Servers with no allowlisted tool are dropped entirely.
 */
export function restrictMcpConfigsToReplayAllowlist(
  mcpConfigs: AgentRuntimeConfig["mcpConfigs"],
  allowlist: EvalReplayAllowedTool[] | undefined,
): AgentRuntimeConfig["mcpConfigs"] | undefined {
  if (!allowlist || allowlist.length === 0) return undefined;
  if (!mcpConfigs || mcpConfigs.length === 0) return undefined;

  // Group allowlisted tool names by server. Deduped so a server's
  // toolWhitelist never repeats a tool.
  const allowedByServer = new Map<string, Set<string>>();
  for (const entry of allowlist) {
    const server = entry.serverName?.trim();
    const tool = entry.toolName?.trim();
    if (!server || !tool) continue;
    const set = allowedByServer.get(server) ?? new Set<string>();
    set.add(tool);
    allowedByServer.set(server, set);
  }
  if (allowedByServer.size === 0) return undefined;

  const restricted = mcpConfigs
    .map((server) => {
      const allowed = allowedByServer.get(server.name);
      if (!allowed || allowed.size === 0) return null;
      // Intersect with the server's actually-available tools when the
      // runtime config knows them, so a stale allowlist row can't smuggle
      // a tool the server doesn't expose; absent availableTools, trust the
      // operator allowlist (the runtime still gates via toolWhitelist).
      const availableNames = new Set(
        (server.availableTools ?? []).map((t) => t.trim()).filter(Boolean),
      );
      const tools = [...allowed].filter((tool) =>
        availableNames.size > 0 ? availableNames.has(tool) : true,
      );
      if (tools.length === 0) return null;
      return { ...server, tools };
    })
    .filter((server): server is NonNullable<typeof server> => server !== null);

  return restricted.length > 0 ? restricted : undefined;
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
   * Operator-curated read-only MCP tool allowlist for replay (U13).
   * Default-deny: omitted/empty → no MCP servers reach the runtime
   * (`mcp_configs: undefined`, the pre-U13 safe behavior).
   */
  replayToolAllowlist?: EvalReplayAllowedTool[];
}): Record<string, unknown> {
  const runtimeConfig = input.runtimeConfig;
  const mcpConfigs = restrictMcpConfigsToReplayAllowlist(
    runtimeConfig.mcpConfigs,
    input.replayToolAllowlist,
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
    knowledge_bases: runtimeConfig.knowledgeBasesConfig,
    trigger_channel: "eval",
    guardrail_config: runtimeConfig.guardrailConfig || undefined,
    // Read-only MCP tools on replay (U13): default-deny via the per-tenant
    // operator allowlist. Each surviving server carries only its
    // allowlisted tools as the runtime's per-server toolWhitelist; mutating
    // tools and the email/web kill-list above stay blocked. Empty allowlist
    // → undefined (the pre-U13 strip-everything default).
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
  /** Read-only MCP tool allowlist for replay (U13). Default-deny. */
  replayToolAllowlist?: EvalReplayAllowedTool[];
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
  replayToolAllowlist?: EvalReplayAllowedTool[];
}): Promise<{
  output: string;
  durationMs: number;
  composedSystemPrompt: string | null;
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

  return {
    output,
    durationMs: Date.now() - startedAt,
    composedSystemPrompt,
  };
}
