import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PI_APPLICATION_SDK_MIN_VERSION,
  PI_APPLICATION_SDK_PACKAGE,
  postFinalizeCallback,
  type DelegationProvider,
  type DesktopPiRuntimeInvocation,
  type PreparedDesktopPiRuntimeSession,
  type RunAgentLoopResult,
} from "@thinkwork/pi-runtime-core";
import { Type } from "typebox";
import { createManagedDelegationClient } from "./managed-delegation-client.js";
import { createBedrockRuntimeAdapter } from "./runtime-adapters/bedrock.js";
import { createHindsightRuntimeAdapter } from "./runtime-adapters/hindsight.js";
import {
  createRedactedLogger,
  type RedactedLogger,
} from "./redacted-logger.js";
import {
  WorkspaceCache,
  type WorkspaceObjectStore,
  type WorkspaceSyncResult,
} from "./workspace-cache.js";

export interface LocalDesktopTurnPayload {
  session: PreparedDesktopPiRuntimeSession;
  workspaceCacheRoot: string;
}

export interface PiSdkSessionLike {
  prompt(text: string, options?: Record<string, unknown>): Promise<void>;
  messages?: unknown[];
  dispose?: () => void;
  abort?: () => Promise<void>;
}

export interface PiSdkModuleLike {
  defineTool?: (definition: Record<string, unknown>) => unknown;
  createAgentSession(options?: Record<string, unknown>): Promise<{
    session: PiSdkSessionLike;
    modelFallbackMessage?: string;
  }>;
  SessionManager?: {
    inMemory(): unknown;
  };
  SettingsManager?: {
    inMemory(options?: Record<string, unknown>): unknown;
  };
  DefaultResourceLoader?: new (options: Record<string, unknown>) => {
    reload?: () => Promise<void>;
  };
}

export interface LocalTurnRunnerDeps {
  now?: () => Date;
  fetchImpl?: typeof fetch;
  loadPiSdk?: () => Promise<PiSdkModuleLike>;
  workspaceStore?: WorkspaceObjectStore;
  logger?: RedactedLogger;
  signal?: AbortSignal;
  turnTimeoutMs?: number;
  debug?: boolean;
}

export interface LocalTurnRunnerResult {
  finalized: boolean;
  status: "completed" | "failed";
  fallbackEligible: boolean;
  workspace?: WorkspaceSyncResult;
}

const READ_ONLY_WORKSPACE_TOOLS = ["read", "grep", "find", "ls"] as const;
const PROMPT_SOURCE_FILENAMES = new Set(["AGENTS.md", "SPACE.md", "USER.md"]);

export async function runLocalDesktopTurn(
  payload: LocalDesktopTurnPayload,
  deps: LocalTurnRunnerDeps = {},
): Promise<LocalTurnRunnerResult> {
  const startedAt = deps.now?.() ?? new Date();
  const logger = deps.logger ?? createRedactedLogger();
  let workspace: WorkspaceSyncResult | undefined;
  let sdkSession:
    | { session: PiSdkSessionLike; modelFallbackMessage?: string }
    | undefined;
  let unbindAbort: (() => void) | undefined;

  try {
    throwIfAborted(deps.signal);
    validatePreparedSession(payload.session, deps.now);
    logger.info("local Pi turn starting", {
      threadTurnId: payload.session.threadTurnId,
      runtimeHost: payload.session.invocation.runtime_host,
      sdkPackage: payload.session.invocation.pi_sdk.packageName,
      sdkMinimumVersion: payload.session.invocation.pi_sdk.minimumVersion,
    });
    throwIfAborted(deps.signal);
    workspace = await prepareWorkspace(payload, deps);
    logger.info("local Pi workspace synced", {
      synced: workspace.synced,
      deleted: workspace.deleted,
      total: workspace.total,
      hasWorkspace: Boolean(workspace.prefix),
    });
    const systemPrompt = buildSystemPrompt(payload.session.invocation);
    await maybeWriteDebugBundle({
      payload,
      workspaceDir: workspace.localDir,
      systemPrompt,
      logger,
      enabled: deps.debug === true,
    });
    throwIfAborted(deps.signal);
    const sdk = await (deps.loadPiSdk ?? loadDefaultPiSdk)();
    logger.info("local Pi SDK loaded", {
      packageName: payload.session.invocation.pi_sdk.packageName,
      minimumVersion: payload.session.invocation.pi_sdk.minimumVersion,
    });
    throwIfAborted(deps.signal);
    sdkSession = await createSdkSession(
      sdk,
      payload.session,
      workspace.localDir,
      systemPrompt,
      logger,
      deps,
    );
    unbindAbort = bindAbortSignal(deps.signal, sdkSession.session, logger);
    const prompt = buildTurnPrompt(payload.session.invocation);
    throwIfAborted(deps.signal);
    logger.info("local Pi SDK prompt starting", {
      promptChars: prompt.length,
      timeoutMs: deps.turnTimeoutMs ?? null,
    });
    await promptWithTimeout(sdkSession.session, prompt, {
      signal: deps.signal,
      logger,
      timeoutMs: deps.turnTimeoutMs,
    });
    throwIfAborted(deps.signal);
    const toolNames = collectToolNames(sdkSession.session.messages ?? []);
    logger.info("local Pi SDK prompt completed", {
      messageCount: sdkSession.session.messages?.length ?? 0,
      toolCount: toolNames.length,
      tools: toolNames,
    });
    const runResult = buildRunResult(
      payload.session.invocation,
      sdkSession.session,
    );

    const finalized = await finalizeTurn({
      prepared: payload.session,
      runResult,
      status: "ok",
      startedAt,
      deps,
      logger,
    });
    logger.info("local Pi turn finalized", {
      status: "completed",
      finalized,
      toolCount: runResult.toolsCalled.length,
      tools: runResult.toolsCalled,
    });
    return {
      finalized,
      status: "completed",
      fallbackEligible: false,
      workspace,
    };
  } catch (error) {
    logger.error("local Pi turn failed", {
      error: error instanceof Error ? error.message : String(error),
      threadTurnId: payload.session.threadTurnId,
    });
    const finalized = await finalizeTurn({
      prepared: payload.session,
      error,
      status: "error",
      startedAt,
      deps,
      logger,
    });
    logger.warn("local Pi turn finalized", {
      status: "failed",
      finalized,
      fallbackEligible: !payload.session.invocation.thread_turn_id,
    });
    return {
      finalized,
      status: "failed",
      fallbackEligible: !payload.session.invocation.thread_turn_id,
      workspace,
    };
  } finally {
    unbindAbort?.();
    sdkSession?.session.dispose?.();
  }
}

export function validatePreparedSession(
  prepared: PreparedDesktopPiRuntimeSession,
  now: () => Date = () => new Date(),
): void {
  const contract = prepared.invocation.pi_sdk;
  if (
    contract.packageName !== PI_APPLICATION_SDK_PACKAGE ||
    contract.minimumVersion !== PI_APPLICATION_SDK_MIN_VERSION ||
    contract.sessionFactory !== "createAgentSession"
  ) {
    throw new Error("Prepared desktop Pi session uses an unsupported Pi SDK");
  }
  const expiresAtMs = Date.parse(prepared.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now().getTime()) {
    throw new Error("Prepared desktop Pi session has expired");
  }
  if (prepared.invocation.runtime_host !== "desktop-local") {
    throw new Error("Prepared desktop Pi session is not a desktop-local turn");
  }
}

async function prepareWorkspace(
  payload: LocalDesktopTurnPayload,
  deps: LocalTurnRunnerDeps,
): Promise<WorkspaceSyncResult> {
  const { invocation } = payload.session;
  const bucket = invocation.workspace_bucket;
  const renderedPrefix = invocation.rendered_workspace_prefix;
  const tenantSlug = invocation.tenant_slug;
  const agentSlug = invocation.instance_id;
  const turnContext = readRecord(invocation.turn_context);
  const spaceId = stringValue(turnContext?.spaceId) ?? invocation.thread_id;

  if (!bucket || !renderedPrefix || !tenantSlug || !agentSlug) {
    const localDir = path.join(payload.workspaceCacheRoot, "empty-workspace");
    await mkdir(localDir, { recursive: true });
    return { localDir, prefix: "", synced: 0, deleted: 0, total: 0 };
  }

  const cache = new WorkspaceCache(
    payload.workspaceCacheRoot,
    deps.workspaceStore,
  );
  return cache.sync({
    bucket,
    renderedPrefix,
    partition: {
      stage: stringValue(invocation.stage) ?? "default",
      tenantSlug,
      agentSlug,
      spaceId,
      userId: invocation.user_id,
    },
  });
}

async function createSdkSession(
  sdk: PiSdkModuleLike,
  prepared: PreparedDesktopPiRuntimeSession,
  workspaceDir: string,
  systemPrompt: string,
  logger: RedactedLogger,
  deps: LocalTurnRunnerDeps,
): Promise<{ session: PiSdkSessionLike; modelFallbackMessage?: string }> {
  if (typeof sdk.createAgentSession !== "function") {
    throw new Error("Pi SDK createAgentSession export is unavailable");
  }

  const { invocation } = prepared;
  const settingsManager = sdk.SettingsManager?.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 1 },
  });
  const resourceLoader = sdk.DefaultResourceLoader
    ? new sdk.DefaultResourceLoader({
        cwd: workspaceDir,
        agentDir: path.join(workspaceDir, ".thinkwork-pi"),
        settingsManager,
        systemPromptOverride: () => systemPrompt,
      })
    : undefined;
  await resourceLoader?.reload?.();

  const bedrock = createBedrockRuntimeAdapter(prepared);
  const hindsight = createHindsightRuntimeAdapter(prepared);
  const managedDelegation = createManagedDelegationClient({
    apiUrl: invocation.thinkwork_api_url,
    parentThreadTurnId: invocation.thread_turn_id,
    finalizeCallbackSecret: invocation.finalize_callback_secret,
  });
  const delegationTools = createDelegationTools(sdk, managedDelegation, logger);
  const webSearchTools = createWebSearchTools(
    sdk,
    invocation,
    logger,
    deps.fetchImpl ?? fetch,
  );
  const tools = [
    ...READ_ONLY_WORKSPACE_TOOLS,
    ...(webSearchTools.length > 0 ? ["web_search"] : []),
    ...(delegationTools.length > 0 ? ["delegate_to_managed_agent"] : []),
  ];
  const customTools = [...webSearchTools, ...delegationTools];

  logger.info("local Pi SDK session creating", {
    tools,
    customToolCount: customTools.length,
    webSearchEnabled: webSearchTools.length > 0,
    mcpConfigCount: Array.isArray(invocation.mcp_configs)
      ? invocation.mcp_configs.length
      : 0,
    hasResourceLoader: Boolean(resourceLoader),
  });

  return sdk.createAgentSession({
    cwd: workspaceDir,
    tools,
    customTools,
    resourceLoader,
    sessionManager: sdk.SessionManager?.inMemory(),
    settingsManager,
    sessionStartEvent: {
      source: "thinkwork-desktop-local-pi",
      metadata: {
        runtime_host: invocation.runtime_host,
        thread_turn_id: invocation.thread_turn_id,
        bedrock,
        hindsight,
      },
    },
  });
}

function createWebSearchTools(
  sdk: PiSdkModuleLike,
  invocation: DesktopPiRuntimeInvocation,
  logger: RedactedLogger,
  fetchImpl: typeof fetch,
): unknown[] {
  if (typeof sdk.defineTool !== "function") return [];
  const config = readWebSearchConfig(invocation.web_search_config);
  if (!config) return [];

  return [
    sdk.defineTool({
      name: "web_search",
      label: "Web Search",
      description:
        "Search the web with the tenant-configured provider. Use this for current facts, weather, recent sources, or anything that requires up-to-date web information.",
      parameters: Type.Object({
        query: Type.String({
          description: "Search query to run.",
        }),
        limit: Type.Optional(
          Type.Number({
            description: "Maximum number of results to return, from 1 to 10.",
          }),
        ),
      }),
      execute: async (_toolCallId: string, params: Record<string, unknown>) => {
        const query =
          typeof params.query === "string" ? params.query.trim() : "";
        const limit = clampResultLimit(
          typeof params.limit === "number" ? params.limit : 5,
        );
        if (!query) {
          throw new Error("web_search requires a non-empty query");
        }
        logger.info("local Pi web search requested", {
          provider: config.provider,
          queryChars: query.length,
          limit,
        });
        const results = await runLocalWebSearch({
          provider: config.provider,
          apiKey: config.apiKey,
          query,
          limit,
          fetchImpl,
        });
        logger.info("local Pi web search completed", {
          provider: config.provider,
          resultCount: results.length,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ results }),
            },
          ],
          results,
        };
      },
    }),
  ];
}

function createDelegationTools(
  sdk: PiSdkModuleLike,
  delegationProvider: DelegationProvider,
  logger: RedactedLogger,
): unknown[] {
  if (typeof sdk.defineTool !== "function") return [];
  return [
    sdk.defineTool({
      name: "delegate_to_managed_agent",
      label: "Delegate",
      description:
        "Ask a managed AWS ThinkWork agent worker to perform hosted, long-running, risky, or cloud-isolated work.",
      parameters: Type.Object({
        task: Type.String({
          description: "Concrete work for the managed agent to perform.",
        }),
        visibility: Type.Optional(
          Type.Union([Type.Literal("hidden"), Type.Literal("visible")], {
            description:
              "Use hidden for routine helper work; visible for consequential, long-running, risky, or user-steerable work.",
          }),
        ),
        reason: Type.Optional(
          Type.String({
            description: "Short reason the work should run in AWS.",
          }),
        ),
        timeoutMs: Type.Optional(
          Type.Number({
            description:
              "How long to wait for a hidden delegation result before returning accepted status.",
          }),
        ),
      }),
      execute: async (_toolCallId: string, params: Record<string, unknown>) => {
        const task = typeof params.task === "string" ? params.task : "";
        const visibility =
          params.visibility === "visible" || params.visibility === "hidden"
            ? params.visibility
            : "hidden";
        logger.info("local Pi managed delegation requested", {
          visibility,
          hasTask: task.length > 0,
          hasReason: typeof params.reason === "string",
          timeoutMs:
            typeof params.timeoutMs === "number" ? params.timeoutMs : null,
        });
        const result = await delegationProvider.delegate({
          task,
          visibility,
          reason: typeof params.reason === "string" ? params.reason : undefined,
          timeoutMs:
            typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
        });
        logger.info("local Pi managed delegation completed", {
          visibility,
          resultStatus: stringValue(readRecord(result)?.status) ?? "unknown",
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
          details: result,
        };
      },
    }),
  ];
}

function buildSystemPrompt(invocation: DesktopPiRuntimeInvocation): string {
  const base = invocation.system_prompt?.trim() || "You are ThinkWork Pi.";
  return `${base}

You are running inside the ThinkWork desktop local Pi sidecar.
Use only the rendered app workspace mounted as the current working directory.
Do not attempt to read arbitrary local folders, shell out, access the clipboard, use screenshots, or operate the local browser.
When work needs hosted isolation, long runtime, cloud-only tools, or consequential user-visible execution, use delegate_to_managed_agent instead of trying to perform that work locally.
If the user asks for local filesystem or OS access outside the rendered app workspace, refuse briefly and explain that desktop local Pi v1 is limited to the approved ThinkWork app workspace.`;
}

async function maybeWriteDebugBundle(args: {
  payload: LocalDesktopTurnPayload;
  workspaceDir: string;
  systemPrompt: string;
  logger: RedactedLogger;
  enabled: boolean;
}): Promise<void> {
  if (!args.enabled) return;
  const promptFiles = await collectPromptSourceFiles(args.workspaceDir);
  const debugDir = path.join(
    args.payload.workspaceCacheRoot,
    "debug",
    safePathSegment(args.payload.session.threadTurnId || "turn"),
  );
  await mkdir(debugDir, { recursive: true });
  const debugPath = path.join(debugDir, "system-prompt.md");
  await writeFile(
    debugPath,
    renderDebugBundle({
      invocation: args.payload.session.invocation,
      systemPrompt: args.systemPrompt,
      promptFiles,
    }),
    "utf8",
  );
  args.logger.info("local Pi debug bundle written", {
    file: debugPath,
    promptChars: args.systemPrompt.length,
    promptFileCount: promptFiles.length,
    promptFiles: promptFiles.map((file) => file.relativePath),
  });
}

interface PromptSourceFile {
  relativePath: string;
  content: string;
  sha256: string;
}

async function collectPromptSourceFiles(
  workspaceDir: string,
): Promise<PromptSourceFile[]> {
  const files: PromptSourceFile[] = [];
  await visitPromptSourceFiles(workspaceDir, workspaceDir, 0, files);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function visitPromptSourceFiles(
  root: string,
  dir: string,
  depth: number,
  files: PromptSourceFile[],
): Promise<void> {
  if (depth > 4) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await visitPromptSourceFiles(root, absolutePath, depth + 1, files);
      continue;
    }
    if (!entry.isFile() || !PROMPT_SOURCE_FILENAMES.has(entry.name)) continue;
    const content = await readFile(absolutePath, "utf8").catch(() => "");
    files.push({
      relativePath: path.relative(root, absolutePath),
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
}

function renderDebugBundle(args: {
  invocation: DesktopPiRuntimeInvocation;
  systemPrompt: string;
  promptFiles: PromptSourceFile[];
}): string {
  const webSearch = readWebSearchConfig(args.invocation.web_search_config);
  const mcpConfigs = Array.isArray(args.invocation.mcp_configs)
    ? args.invocation.mcp_configs
    : [];
  return [
    "# Desktop Local Pi Debug Bundle",
    "",
    "## Invocation",
    "",
    `- thread_turn_id: ${args.invocation.thread_turn_id}`,
    `- trace_id: ${args.invocation.trace_id}`,
    `- runtime_host: ${args.invocation.runtime_host}`,
    `- model: ${args.invocation.model ?? "unknown"}`,
    `- web_search: ${webSearch ? `${webSearch.provider} enabled` : "not configured"}`,
    `- mcp_configs: ${mcpConfigs.length}`,
    "",
    "## Composed System Prompt",
    "",
    "````text",
    args.systemPrompt,
    "````",
    "",
    "## Prompt Source Files",
    "",
    ...(args.promptFiles.length > 0
      ? args.promptFiles.flatMap((file) => [
          `### ${file.relativePath}`,
          "",
          `- chars: ${file.content.length}`,
          `- sha256: ${file.sha256}`,
          "",
          "````markdown",
          file.content,
          "````",
          "",
        ])
      : ["No AGENTS.md, SPACE.md, or USER.md files were found.", ""]),
  ].join("\n");
}

function buildTurnPrompt(invocation: DesktopPiRuntimeInvocation): string {
  const history = invocation.messages_history
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const historyBlock = history ? `Prior conversation:\n${history}\n\n` : "";
  return `${historyBlock}Current user message:\n${invocation.message}`;
}

async function promptWithTimeout(
  session: PiSdkSessionLike,
  prompt: string,
  options: {
    signal?: AbortSignal;
    logger: RedactedLogger;
    timeoutMs?: number;
  },
): Promise<void> {
  const timeoutMs = options.timeoutMs;
  if (!timeoutMs || timeoutMs <= 0) {
    await session.prompt(prompt, { source: "sdk" });
    return;
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      session.prompt(prompt, { source: "sdk" }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          options.logger.warn("local Pi SDK prompt timeout", { timeoutMs });
          void session.abort?.().catch((error: unknown) => {
            options.logger.warn("failed to abort timed out local Pi session", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
          reject(
            new Error(`Local Pi SDK prompt timed out after ${timeoutMs}ms`),
          );
        }, timeoutMs);
        options.signal?.addEventListener(
          "abort",
          () => {
            reject(new Error("Local Pi turn was cancelled"));
          },
          { once: true },
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function buildRunResult(
  invocation: DesktopPiRuntimeInvocation,
  session: PiSdkSessionLike,
): RunAgentLoopResult {
  const assistant = findLastAssistantMessage(session.messages ?? []);
  const content = assistant ? assistantMessageText(assistant) : "";
  const toolNames = collectToolNames(session.messages ?? []);
  const toolInvocations = toolNames.map((name, index) => ({
    id: `desktop-local-tool-${index + 1}`,
    name,
    tool_name: name,
    runtime: "pi" as const,
  }));
  return {
    content,
    usage: readRecord(assistant)?.usage as RunAgentLoopResult["usage"],
    modelId:
      stringValue(readRecord(assistant)?.model) ??
      invocation.model ??
      "desktop-local-pi",
    toolsCalled: toolNames,
    toolInvocations,
  };
}

type WebSearchProvider = "exa" | "serpapi";

interface LocalWebSearchConfig {
  provider: WebSearchProvider;
  apiKey: string;
}

interface LocalWebSearchResult {
  id: string;
  title: string;
  url?: string;
  snippet: string;
  score: number;
}

async function runLocalWebSearch(args: {
  provider: WebSearchProvider;
  apiKey: string;
  query: string;
  limit: number;
  fetchImpl: typeof fetch;
}): Promise<LocalWebSearchResult[]> {
  if (args.provider === "serpapi") return runLocalSerpApiSearch(args);
  return runLocalExaSearch(args);
}

async function runLocalExaSearch(args: {
  apiKey: string;
  query: string;
  limit: number;
  fetchImpl: typeof fetch;
}): Promise<LocalWebSearchResult[]> {
  const response = await args.fetchImpl("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": args.apiKey,
      "User-Agent": "Thinkwork/1.0",
    },
    body: JSON.stringify({
      query: args.query,
      numResults: args.limit,
      contents: { summary: true },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    results?: unknown[];
    error?: string;
  };
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error ||
        `Exa ${response.status}: ${JSON.stringify(payload).slice(0, 200)}`,
    );
  }
  return (Array.isArray(payload.results) ? payload.results : [])
    .slice(0, args.limit)
    .map((item, index) => normalizeExaResult(item, index))
    .filter((item): item is LocalWebSearchResult => item !== null);
}

async function runLocalSerpApiSearch(args: {
  apiKey: string;
  query: string;
  limit: number;
  fetchImpl: typeof fetch;
}): Promise<LocalWebSearchResult[]> {
  const params = new URLSearchParams({
    engine: "google",
    q: args.query,
    num: String(args.limit),
    api_key: args.apiKey,
  });
  const response = await args.fetchImpl(
    `https://serpapi.com/search.json?${params}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    organic_results?: unknown[];
    error?: string;
  };
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error ||
        `SerpAPI ${response.status}: ${JSON.stringify(payload).slice(0, 200)}`,
    );
  }
  return (Array.isArray(payload.organic_results) ? payload.organic_results : [])
    .slice(0, args.limit)
    .map((item, index) => normalizeSerpApiResult(item, index))
    .filter((item): item is LocalWebSearchResult => item !== null);
}

function normalizeExaResult(
  item: unknown,
  index: number,
): LocalWebSearchResult | null {
  const record = readRecord(item);
  if (!record) return null;
  const title = stringValue(record.title) || stringValue(record.url);
  const snippet =
    stringValue(record.summary) ||
    stringValue(record.highlights) ||
    cleanSearchText(stringValue(record.text));
  if (!title || !snippet) return null;
  return {
    id: stringValue(record.id) ?? String(index + 1),
    title,
    url: stringValue(record.url),
    snippet: snippet.slice(0, 700),
    score: numberValue(record.score) ?? 1 / (index + 1),
  };
}

function normalizeSerpApiResult(
  item: unknown,
  index: number,
): LocalWebSearchResult | null {
  const record = readRecord(item);
  if (!record) return null;
  const title = stringValue(record.title) || stringValue(record.link);
  const snippet = stringValue(record.snippet);
  if (!title || !snippet) return null;
  return {
    id: stringValue(record.position) ?? String(index + 1),
    title,
    url: stringValue(record.link),
    snippet: snippet.slice(0, 700),
    score: 1 / (index + 1),
  };
}

function readWebSearchConfig(value: unknown): LocalWebSearchConfig | null {
  const record = readRecord(value);
  if (!record) return null;
  const provider = record.provider === "serpapi" ? "serpapi" : "exa";
  const apiKey = stringValue(record.apiKey);
  return apiKey ? { provider, apiKey } : null;
}

function clampResultLimit(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(Math.floor(value), 10));
}

function cleanSearchText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const cleaned = text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || undefined;
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "turn";
}

async function finalizeTurn(args: {
  prepared: PreparedDesktopPiRuntimeSession;
  status: "ok" | "error";
  runResult?: RunAgentLoopResult;
  error?: unknown;
  startedAt: Date;
  deps: LocalTurnRunnerDeps;
  logger: RedactedLogger;
}): Promise<boolean> {
  const latencyMs = Math.max(
    0,
    (args.deps.now?.() ?? new Date()).getTime() - args.startedAt.getTime(),
  );
  return postFinalizeCallback({
    payload: {
      ...args.prepared.invocation,
      runtime_host: "desktop-local",
    },
    identity: {
      tenantId: args.prepared.invocation.tenant_id,
      userId: args.prepared.invocation.user_id,
      agentId: args.prepared.invocation.assistant_id,
      threadId: args.prepared.invocation.thread_id,
      tenantSlug: args.prepared.invocation.tenant_slug,
      agentSlug: args.prepared.invocation.instance_id,
      traceId: args.prepared.invocation.trace_id,
    },
    systemPrompt: args.prepared.invocation.system_prompt,
    result:
      args.status === "ok" && args.runResult
        ? { status: "ok", runResult: args.runResult, latencyMs }
        : { status: "error", error: args.error, latencyMs },
    fetchImpl: args.deps.fetchImpl ?? fetch,
    logger: (entry) => args.logger[entry.level](entry.event, entry),
  });
}

async function loadDefaultPiSdk(): Promise<PiSdkModuleLike> {
  return (await import("@earendil-works/pi-coding-agent")) as unknown as PiSdkModuleLike;
}

function bindAbortSignal(
  signal: AbortSignal | undefined,
  session: PiSdkSessionLike,
  logger: RedactedLogger,
): (() => void) | undefined {
  if (!signal) return undefined;
  const abortSession = (): void => {
    void session.abort?.().catch((error: unknown) => {
      logger.warn("failed to abort local Pi SDK session", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  signal.addEventListener("abort", abortSession, { once: true });
  if (signal.aborted) abortSession();
  return () => signal.removeEventListener("abort", abortSession);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const error = new Error("Local Pi turn was cancelled");
  error.name = "AbortError";
  throw error;
}

function findLastAssistantMessage(messages: unknown[]): unknown | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const candidate = readRecord(messages[index]);
    if (candidate?.role === "assistant") return candidate;
  }
  return null;
}

function assistantMessageText(message: unknown): string {
  const content = readRecord(message)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      const record = readRecord(block);
      if (record?.type === "text" && typeof record.text === "string") {
        return record.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function collectToolNames(messages: unknown[]): string[] {
  const tools = new Set<string>();
  for (const message of messages) {
    collectToolNamesFromValue(message, tools);
  }
  return [...tools];
}

function collectToolNamesFromValue(value: unknown, tools: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) collectToolNamesFromValue(entry, tools);
    return;
  }

  const record = value as Record<string, unknown>;
  const type = stringValue(record.type) ?? stringValue(record.role);
  const name =
    stringValue(record.toolName) ??
    stringValue(record.tool_name) ??
    stringValue(record.name);
  if (name && /tool|function|call|result|use/i.test(type ?? "")) {
    tools.add(name);
  }

  for (const entry of Object.values(record)) {
    collectToolNamesFromValue(entry, tools);
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
