/**
 * Plan §005 U9 — Trusted handler shell (the keystone unit).
 *
 * This is the production entry point for the agentcore-flue Lambda /
 * AgentCore runtime container. It binds U4-U8 into a single per-invocation
 * orchestrator:
 *
 *   - U4: AuroraSessionStore — Flue's session-blob persistence.
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
import { Agent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  Message,
  TextContent,
  Usage,
} from "@mariozechner/pi-ai";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import {
  BedrockAgentCoreClient,
} from "@aws-sdk/client-bedrock-agentcore";
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
import { buildHindsightTools } from "./tools/hindsight.js";
import { buildMemoryTools } from "./tools/memory.js";
import {
  AuroraSessionStore,
  type AuroraSessionStoreOptions,
} from "./sessionstore-aurora.js";
import { resolveSandboxFactory } from "./runtime/sandbox-factory.js";
import { bootstrapWorkspace } from "./runtime/bootstrap-workspace.js";
import { composeSystemPrompt } from "./runtime/system-prompt.js";
import { buildRunSkillTool } from "./runtime/tools/run-skill.js";
import {
  discoverWorkspaceSkills,
  formatWorkspaceSkills,
  type WorkspaceSkill,
} from "./runtime/tools/workspace-skills.js";

const PORT = Number(process.env.PORT || 8080);

// ---------------------------------------------------------------------------
// Types — payload + response shapes the handler exposes.
// ---------------------------------------------------------------------------

export interface InvocationResponse {
  response: {
    role: "assistant";
    content: string;
    runtime: "flue";
    model: string;
    usage?: Usage;
    tools_called?: string[];
  };
  runtime: "flue";
  flue_usage?: Usage;
  tools_called?: string[];
}

interface HistoryMessage {
  role?: unknown;
  content?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHistory(history: unknown): Message[] {
  if (!Array.isArray(history)) return [];
  return history.flatMap((entry: HistoryMessage) => {
    if (
      (entry.role === "user" || entry.role === "assistant") &&
      typeof entry.content === "string" &&
      entry.content.trim()
    ) {
      return [
        {
          role: entry.role,
          content: entry.content,
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
      : "anthropic.claude-sonnet-4-5-20250929-v1:0";
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
    const serverName = asString(record.name) || asString(record.serverName) || url;
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
  /** Optional override for the MCP connect factory (tests inject fakes). */
  connectMcpServerFactory?: ConnectMcpServerFn;
  /**
   * Optional override for the SessionStore constructor (tests inject fakes).
   * Production callers omit this and the default `AuroraSessionStore` runs.
   */
  sessionStoreFactory?: (
    opts: AuroraSessionStoreOptions,
  ) => AuroraSessionStore;
  /**
   * Optional override for the completion-callback HTTP fetch (tests inject
   * fakes). Production uses native `fetch` at invocation time.
   */
  fetchImpl?: typeof fetch;
  /** Optional override for the agent loop (test-only). */
  runAgentLoop?: typeof runAgentLoop;
  /** Optional override for the workspace S3 sync (test-only). */
  bootstrapWorkspaceImpl?: typeof bootstrapWorkspace;
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
};

// ---------------------------------------------------------------------------
// Tool assembly — pure given the snapshots + payload + factories.
// ---------------------------------------------------------------------------

export interface AssembledToolBundle {
  tools: AgentTool<any>[];
  cleanup: Array<() => Promise<void>>;
  workspaceSkills: WorkspaceSkill[];
  handleStore: HandleStore;
}

export interface AssembleToolsArgs {
  payload: Record<string, unknown>;
  identity: IdentitySnapshot;
  env: RuntimeEnvSnapshot;
  agentCoreClient: BedrockAgentCoreClient;
  workspaceSkills: WorkspaceSkill[];
  connectMcpServer: ConnectMcpServerFn;
  sessionStoreFactory: (opts: AuroraSessionStoreOptions) => AuroraSessionStore;
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
  const cleanup: Array<() => Promise<void>> = [];
  const handleStore = new HandleStore();

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

  // Memory (U6) — engine selector lives in env.
  if (args.env.memoryEngine === "managed") {
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
  });
  tools.push(...mcpTools);

  return { tools, cleanup, workspaceSkills: args.workspaceSkills, handleStore };
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
}

export async function runAgentLoop(
  args: RunAgentLoopArgs,
): Promise<RunAgentLoopResult> {
  const model = resolveModel(args.modelId);
  const toolsCalled = new Set<string>();

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
        runtime: "flue",
        git_sha: args.gitSha,
        thread_id: args.threadId,
      },
    }),
  });

  agent.subscribe((event: AgentEvent) => {
    if (event.type === "tool_execution_start") {
      toolsCalled.add(event.toolName);
    }
  });

  await agent.prompt(args.message);
  const assistant = [...agent.state.messages]
    .reverse()
    .find((message): message is AssistantMessage => message.role === "assistant");

  return {
    content: textFromAssistant(assistant),
    usage: assistant?.usage,
    modelId: model.id,
    toolsCalled: [...toolsCalled],
  };
}

// ---------------------------------------------------------------------------
// Completion callback — POST /api/skills/complete with snapshotted secret.
// ---------------------------------------------------------------------------

export interface CompletionCallbackArgs {
  secrets: SecretsSnapshot;
  identity: IdentitySnapshot;
  result:
    | { status: "ok"; runResult: RunAgentLoopResult; latencyMs: number }
    | { status: "error"; error: unknown; latencyMs: number };
  fetchImpl: typeof fetch;
}

export class CompletionCallbackAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionCallbackAuthError";
  }
}

const COMPLETION_RETRY_DELAYS_MS = [200, 600, 1500] as const;

/**
 * POST `/api/skills/complete` with the snapshotted secret. 401 surfaces as
 * `CompletionCallbackAuthError` (per `feedback_avoid_fire_and_forget_lambda_invokes`)
 * so a runtime-side mismatch with API_AUTH_SECRET fails the invocation
 * loudly instead of silently dropping observability data. Other failures
 * retry with bounded backoff.
 */
export async function postCompletion(
  args: CompletionCallbackArgs,
): Promise<void> {
  const { secrets, identity, result, fetchImpl } = args;
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
  const url = `${secrets.apiUrl.replace(/\/$/, "")}/api/skills/complete`;
  const body = JSON.stringify({
    skill_run_id: identity.threadId,
    tenant_id: identity.tenantId,
    user_id: identity.userId,
    agent_id: identity.agentId,
    runtime: "flue",
    status: result.status,
    latency_ms: result.latencyMs,
    token_usage:
      result.status === "ok"
        ? {
            input_tokens: result.runResult.usage?.input ?? 0,
            output_tokens: result.runResult.usage?.output ?? 0,
          }
        : { input_tokens: 0, output_tokens: 0 },
    error_message:
      result.status === "error"
        ? result.error instanceof Error
          ? result.error.message
          : String(result.error)
        : undefined,
  });

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
        },
        body,
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
        statusCode: response.status,
        attempt,
      });
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
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (attempt < totalAttempts - 1) {
      const delay = COMPLETION_RETRY_DELAYS_MS[attempt] ?? 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
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
        body: { error: err.message, runtime: "flue" },
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
        error: "Flue invocation requires a non-empty `message`.",
        runtime: "flue",
      },
    };
  }

  // Workspace S3 sync — best-effort; failure logs and continues with the
  // stale local tree.
  if (env.workspaceBucket && identity.tenantSlug && identity.agentSlug) {
    try {
      const s3 = deps.s3ClientFactory(env.awsRegion);
      await bootstrap(
        identity.tenantSlug,
        identity.agentSlug,
        env.workspaceDir,
        s3,
        env.workspaceBucket,
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
  const systemPrompt = composeSystemPrompt(
    args.payload,
    formatWorkspaceSkills(workspaceSkills),
  );

  const agentCoreClient = deps.agentCoreClientFactory();

  // Sandbox factory — read it before tools so a missing
  // `sandbox_interpreter_id` fails fast (per U8: contract violation, not a
  // runtime fallback).
  // The current placeholder dispatch (in-process Agent loop) does not invoke
  // the sandbox itself — U16 attaches it when worker isolation lands. We
  // still resolve it here so the contract is enforced at U9 time.
  try {
    resolveSandboxFactory(args.payload as { sandbox_interpreter_id: string }, {
      client: agentCoreClient,
    });
  } catch (err) {
    logStructured({
      level: "error",
      event: "sandbox_resolution_failed",
      tenantId: identity.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      statusCode: 500,
      body: {
        error:
          err instanceof Error
            ? err.message
            : "Sandbox factory resolution failed.",
        runtime: "flue",
      },
    };
  }

  // SessionStore — instantiate so failures surface here, BEFORE the agent
  // loop spends LLM tokens. The current placeholder dispatch reads no
  // session blob (Flue's session.prompt() would; the in-process Agent
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

  const connectMcpServer =
    deps.connectMcpServerFactory ??
    createConnectMcpServer({ cleanup: [] });

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
    });
  } catch (err) {
    logStructured({
      level: "error",
      event: "tool_assembly_failed",
      tenantId: identity.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      statusCode: 500,
      body: {
        error:
          err instanceof Error
            ? err.message
            : "Flue tool assembly failed.",
        runtime: "flue",
      },
    };
  }

  // Run the agent loop inside try/finally so the HandleStore is cleared
  // even if the LLM throws or a tool raises.
  let runResult: RunAgentLoopResult | undefined;
  let runError: unknown;
  try {
    runResult = await runLoop({
      message: userMessage,
      history: normalizeHistory(args.payload.messages_history),
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
    deps.onHandlerComplete?.(bundle);
  }

  const latencyMs = Date.now() - start;

  if (runError !== undefined || !runResult) {
    // Try to fire the completion callback (status=error). 401 from the
    // callback throws — that's an auth-config bug we want loud, not a
    // silent failure on top of a turn failure.
    try {
      await postCompletion({
        secrets,
        identity,
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
        error:
          runError instanceof Error ? runError.message : String(runError),
        runtime: "flue",
      },
    };
  }

  await postCompletion({
    secrets,
    identity,
    result: { status: "ok", runResult, latencyMs },
    fetchImpl,
  });

  const responseBody: InvocationResponse = {
    runtime: "flue",
    flue_usage: runResult.usage,
    tools_called: runResult.toolsCalled,
    response: {
      role: "assistant",
      content: runResult.content,
      runtime: "flue",
      model: runResult.modelId,
      usage: runResult.usage,
      tools_called: runResult.toolsCalled,
    },
  };
  return { statusCode: 200, body: responseBody as unknown as Record<string, unknown> };
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

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleHttpInvocation(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const body = await readBody(req);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: "invalid json", runtime: "flue" });
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
      runtime: "flue",
    });
  }
}

export function createServer() {
  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/ping") {
      sendJson(res, 200, {
        status: "Healthy",
        runtime: "flue",
        time_of_last_update: Math.floor(Date.now() / 1000),
      });
      return;
    }
    if (req.method === "POST" && req.url === "/invocations") {
      void handleHttpInvocation(req, res);
      return;
    }
    sendJson(res, 404, { error: "not found", runtime: "flue" });
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
