import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Type, type TSchema } from "typebox";
import {
  BUILTIN_TOOL_NAMES,
  PI_APPLICATION_SDK_MIN_VERSION,
  PI_APPLICATION_SDK_PACKAGE,
  postFinalizeCallback,
  type DelegationProvider,
  type DesktopPiRuntimeInvocation,
  type MemoryProvider,
  type PreparedDesktopPiRuntimeSession,
  type RunAgentLoopResult,
} from "@thinkwork/pi-runtime-core";
import {
  collectExtensionToolNames,
  createBrowserAutomationExtension,
  createContextEngineExtension,
  createDelegationExtension,
  createMemoryExtension,
  createSendEmailExtension,
  createWebSearchExtension,
  toExtensionFactory,
  type ProviderBundle,
  type ThinkworkExtension,
} from "@thinkwork/pi-extensions";
import { createManagedDelegationClient } from "./managed-delegation-client.js";
import { createBedrockRuntimeAdapter } from "./runtime-adapters/bedrock.js";
import { createHindsightRuntimeAdapter } from "./runtime-adapters/hindsight.js";
import {
  createRedactedLogger,
  type RedactedLogger,
} from "./redacted-logger.js";
import type { PiSidecarWorkspacePrewarmPayload } from "../main/pi-sidecar-session.js";
import {
  WorkspaceCache,
  createS3WorkspaceObjectStore,
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
  bindExtensions?: (bindings: Record<string, unknown>) => Promise<void>;
}

export interface PiSdkAuthStorageLike {
  setRuntimeApiKey?: (provider: string, apiKey: string) => void;
}

export interface PiSdkModuleLike {
  defineTool?: (definition: Record<string, unknown>) => unknown;
  AuthStorage?: {
    create(path?: string): PiSdkAuthStorageLike;
  };
  ModelRegistry?: {
    create(
      authStorage: unknown,
      modelsPath?: string,
    ): {
      find(provider: string, modelId: string): unknown;
    };
  };
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
  connectMcpServer?: DesktopConnectMcpServerFn;
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

interface LocalTurnTimings {
  measure<T>(name: string, run: () => T | Promise<T>): Promise<T>;
  snapshot(): Record<string, number>;
}

function createLocalTurnTimings(now: () => Date = () => new Date()) {
  const startedAtMs = now().getTime();
  const timings: Record<string, number> = {};
  const currentMs = () => now().getTime();

  const addTiming = (name: string, durationMs: number) => {
    timings[name] = Math.max(0, Math.round((timings[name] ?? 0) + durationMs));
  };

  return {
    async measure<T>(name: string, run: () => T | Promise<T>): Promise<T> {
      const phaseStartedAtMs = currentMs();
      try {
        return await run();
      } finally {
        addTiming(name, currentMs() - phaseStartedAtMs);
      }
    },
    snapshot(): Record<string, number> {
      return {
        ...timings,
        total_ms: Math.max(0, Math.round(currentMs() - startedAtMs)),
      };
    },
  } satisfies LocalTurnTimings;
}

export async function prewarmLocalWorkspace(
  payload: PiSidecarWorkspacePrewarmPayload,
  deps: Pick<LocalTurnRunnerDeps, "now" | "workspaceStore" | "logger"> = {},
): Promise<WorkspaceSyncResult> {
  const logger = deps.logger ?? createRedactedLogger();
  const expiresAtMs = Date.parse(payload.session.expiresAt);
  if (
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= (deps.now?.() ?? new Date()).getTime()
  ) {
    throw new Error(
      "Prepared desktop Pi workspace prewarm session has expired",
    );
  }
  const { workspace, partition } = payload.session;
  const cache = new WorkspaceCache(
    payload.workspaceCacheRoot,
    deps.workspaceStore ??
      createS3WorkspaceObjectStore({
        region:
          resolveAwsRegionFromCredentials(payload.session.sidecarCredentials) ??
          stringValue(process.env.AWS_REGION) ??
          stringValue(process.env.AWS_DEFAULT_REGION) ??
          "us-east-1",
      }),
    { now: deps.now },
  );
  const result = await cache.sync({
    bucket: workspace.bucket,
    renderedPrefix: workspace.renderedPrefix,
    partition: {
      stage: partition.stage ?? "default",
      tenantSlug: partition.tenantSlug,
      agentSlug: partition.agentSlug,
      spaceId: partition.spaceId,
      userId: partition.userId,
    },
  });
  logger.info("local Pi workspace prewarmed", {
    synced: result.synced,
    deleted: result.deleted,
    total: result.total,
    cacheHit: result.cacheHit === true,
    cacheStale: result.cacheStale === true,
  });
  return result;
}

const HINDSIGHT_RECALL_MAX_TOKENS = 1_500;
const PROMPT_SOURCE_FILENAMES = new Set(["AGENTS.md", "SPACE.md", "USER.md"]);
const LOCAL_PI_AGENT_DIR = ".thinkwork-pi";
const DEFAULT_BEDROCK_MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const require = createRequire(import.meta.url);
const PI_MCP_ADAPTER_ENTRY = require.resolve("pi-mcp-adapter/index.ts");

export async function runLocalDesktopTurn(
  payload: LocalDesktopTurnPayload,
  deps: LocalTurnRunnerDeps = {},
): Promise<LocalTurnRunnerResult> {
  const startedAt = deps.now?.() ?? new Date();
  const timings = createLocalTurnTimings(deps.now);
  const logger = deps.logger ?? createRedactedLogger();
  let workspace: WorkspaceSyncResult | undefined;
  let sdkSession:
    | {
        session: PiSdkSessionLike;
        modelFallbackMessage?: string;
        resolvedModelId?: string;
        cleanup?: Array<() => Promise<void>>;
      }
    | undefined;
  let unbindAbort: (() => void) | undefined;
  // Snapshot the composed prompt at turn entry so the finalize callback
  // (incl. the catch path) persists exactly what the SDK received, not the
  // raw invocation base. See feedback_completion_callback_snapshot_pattern.
  let composedSystemPrompt: string | undefined;

  try {
    throwIfAborted(deps.signal);
    await timings.measure("session_validation_ms", () =>
      validatePreparedSession(payload.session, deps.now),
    );
    logger.info("local Pi turn starting", {
      threadTurnId: payload.session.threadTurnId,
      runtimeHost: payload.session.invocation.runtime_host,
      sdkPackage: payload.session.invocation.pi_sdk.packageName,
      sdkMinimumVersion: payload.session.invocation.pi_sdk.minimumVersion,
    });
    throwIfAborted(deps.signal);
    const preparedWorkspace = await timings.measure("workspace_sync_ms", () =>
      prepareWorkspace(payload, deps, logger),
    );
    workspace = preparedWorkspace;
    logger.info("local Pi workspace synced", {
      synced: preparedWorkspace.synced,
      deleted: preparedWorkspace.deleted,
      total: preparedWorkspace.total,
      hasWorkspace: Boolean(preparedWorkspace.prefix),
      cacheHit: preparedWorkspace.cacheHit === true,
      cacheStale: preparedWorkspace.cacheStale === true,
    });
    const systemPrompt = await timings.measure("system_prompt_ms", () =>
      buildSystemPrompt(payload.session.invocation),
    );
    composedSystemPrompt = systemPrompt;
    await timings.measure("debug_bundle_ms", () =>
      maybeWriteDebugBundle({
        payload,
        workspaceDir: preparedWorkspace.localDir,
        systemPrompt,
        logger,
        enabled: deps.debug === true,
      }),
    );
    throwIfAborted(deps.signal);
    const sdk = await timings.measure("sdk_load_ms", () =>
      (deps.loadPiSdk ?? loadDefaultPiSdk)(),
    );
    logger.info("local Pi SDK loaded", {
      packageName: payload.session.invocation.pi_sdk.packageName,
      minimumVersion: payload.session.invocation.pi_sdk.minimumVersion,
    });
    throwIfAborted(deps.signal);
    const preparedSdkSession = await createSdkSession(
      sdk,
      payload.session,
      preparedWorkspace.localDir,
      systemPrompt,
      logger,
      deps,
      timings,
    );
    sdkSession = preparedSdkSession;
    unbindAbort = bindAbortSignal(
      deps.signal,
      preparedSdkSession.session,
      logger,
    );
    const prompt = buildTurnPrompt(payload.session.invocation);
    throwIfAborted(deps.signal);
    logger.info("local Pi SDK prompt starting", {
      promptChars: prompt.length,
      timeoutMs: deps.turnTimeoutMs ?? null,
    });
    await timings.measure("sdk_prompt_ms", () =>
      promptWithTimeout(preparedSdkSession.session, prompt, {
        signal: deps.signal,
        logger,
        timeoutMs: deps.turnTimeoutMs,
      }),
    );
    throwIfAborted(deps.signal);
    const toolNames = collectToolNames(
      preparedSdkSession.session.messages ?? [],
    );
    logger.info("local Pi SDK prompt completed", {
      messageCount: preparedSdkSession.session.messages?.length ?? 0,
      toolCount: toolNames.length,
      tools: toolNames,
    });
    const runResult = buildRunResult(
      payload.session.invocation,
      preparedSdkSession.session,
      preparedSdkSession.resolvedModelId,
      { local_pi_timings_ms: timings.snapshot() },
    );
    logger.info("local Pi turn timing", {
      phase: "pre_finalize",
      timings: runResult.diagnostics?.local_pi_timings_ms,
    });

    const finalized = await timings.measure("finalize_callback_ms", () =>
      finalizeTurn({
        prepared: payload.session,
        runResult,
        status: "ok",
        systemPrompt: composedSystemPrompt,
        startedAt,
        deps,
        logger,
      }),
    );
    logger.info("local Pi turn finalized", {
      status: "completed",
      finalized,
      toolCount: runResult.toolsCalled.length,
      tools: runResult.toolsCalled,
      timings: timings.snapshot(),
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
    const finalized = await timings.measure("finalize_callback_ms", () =>
      finalizeTurn({
        prepared: payload.session,
        error,
        status: "error",
        systemPrompt: composedSystemPrompt,
        startedAt,
        deps,
        logger,
      }),
    );
    logger.warn("local Pi turn finalized", {
      status: "failed",
      finalized,
      fallbackEligible: !payload.session.invocation.thread_turn_id,
      timings: timings.snapshot(),
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
    if (sdkSession?.cleanup) {
      for (const cleanup of sdkSession.cleanup) {
        try {
          await cleanup();
        } catch (err) {
          logger.warn("local Pi MCP cleanup failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
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
  logger: RedactedLogger,
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
    deps.workspaceStore ??
      createS3WorkspaceObjectStore({
        region: resolveAwsRegion(
          invocation,
          payload.session.sidecarCredentials,
        ),
      }),
    {
      now: deps.now,
      onBackgroundRefreshError: (err) => {
        logger.warn("local Pi workspace background refresh failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      },
    },
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

function resolveAwsRegion(
  invocation: PreparedDesktopPiRuntimeSession["invocation"],
  sidecarCredentials: unknown,
): string {
  return (
    resolveAwsRegionFromCredentials(sidecarCredentials) ??
    stringValue(invocation.aws_region) ??
    stringValue(process.env.AWS_REGION) ??
    stringValue(process.env.AWS_DEFAULT_REGION) ??
    "us-east-1"
  );
}

function resolveAwsRegionFromCredentials(
  sidecarCredentials: unknown,
): string | undefined {
  const aws = readRecord(readRecord(sidecarCredentials)?.aws);
  return stringValue(aws?.region);
}

async function createSdkSession(
  sdk: PiSdkModuleLike,
  prepared: PreparedDesktopPiRuntimeSession,
  workspaceDir: string,
  systemPrompt: string,
  logger: RedactedLogger,
  deps: LocalTurnRunnerDeps,
  timings: LocalTurnTimings,
): Promise<{
  session: PiSdkSessionLike;
  modelFallbackMessage?: string;
  resolvedModelId?: string;
  cleanup?: Array<() => Promise<void>>;
}> {
  if (typeof sdk.createAgentSession !== "function") {
    throw new Error("Pi SDK createAgentSession export is unavailable");
  }

  const { invocation } = prepared;
  const settingsManager = sdk.SettingsManager?.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 1 },
  });
  const agentDir = path.join(workspaceDir, LOCAL_PI_AGENT_DIR);
  const cleanup: Array<() => Promise<void>> = [];
  try {
    await timings.measure("agent_prompt_files_ms", () =>
      syncLocalPiAgentPromptFiles({
        invocation,
        workspaceDir,
        agentDir,
        systemPrompt,
        logger,
      }),
    );
    const mcpAdapterConfig = deps.connectMcpServer
      ? null
      : await timings.measure("mcp_adapter_config_ms", () =>
          prepareDesktopMcpAdapter({
            agentDir,
            invocation,
            logger,
            cleanup,
          }),
        );
    const extensions = await timings.measure("shared_extensions_ms", () =>
      createDesktopSharedExtensions(
        sdk,
        prepared,
        logger,
        deps.fetchImpl ?? fetch,
        deps.connectMcpServer,
        cleanup,
        mcpAdapterConfig,
      ),
    );
    const resourceLoader = sdk.DefaultResourceLoader
      ? new sdk.DefaultResourceLoader({
          cwd: workspaceDir,
          agentDir,
          settingsManager,
          systemPromptOverride: () => systemPrompt,
          additionalExtensionPaths: mcpAdapterConfig
            ? [mcpAdapterConfig.extensionPath]
            : [],
          extensionFactories: extensions.extensionFactories,
        })
      : undefined;
    await timings.measure("resource_loader_reload_ms", () =>
      resourceLoader?.reload?.(),
    );

    const bedrock = createBedrockRuntimeAdapter(prepared);
    const modelConfig = await timings.measure("model_config_ms", () =>
      createPiSdkModelConfig(sdk, invocation, logger),
    );
    const hindsight = createHindsightRuntimeAdapter(prepared);
    const tools = [...BUILTIN_TOOL_NAMES, ...extensions.toolNames];

    logger.info("local Pi SDK session creating", {
      tools,
      customToolCount: extensions.customTools.length,
      extensionFactoryCount: extensions.extensionFactories.length,
      webSearchEnabled: extensions.toolNames.includes("web_search"),
      browserAutomationEnabled:
        extensions.toolNames.includes("browser_automation"),
      mcpConfigCount: Array.isArray(invocation.mcp_configs)
        ? invocation.mcp_configs.length
        : 0,
      hasResourceLoader: Boolean(resourceLoader),
      agentDir,
      modelProvider: readRecord(modelConfig.options.model)?.provider ?? null,
      modelId: modelConfig.resolvedModelId ?? invocation.model ?? null,
    });

    const session = await timings.measure("sdk_session_create_ms", () =>
      sdk.createAgentSession({
        cwd: workspaceDir,
        tools,
        customTools: extensions.customTools,
        resourceLoader,
        sessionManager: sdk.SessionManager?.inMemory(),
        settingsManager,
        ...modelConfig.options,
        sessionStartEvent: {
          type: "session_start",
          reason: "startup",
          source: "thinkwork-desktop-local-pi",
          metadata: {
            runtime_host: invocation.runtime_host,
            thread_turn_id: invocation.thread_turn_id,
            bedrock,
            hindsight,
          },
        },
      }),
    );
    await timings.measure("bind_extensions_ms", () =>
      session.session.bindExtensions?.({
        onError: (error: unknown) => {
          const record = readRecord(error);
          logger.warn("local Pi extension error", {
            extensionPath: stringValue(record?.extensionPath) ?? null,
            event: stringValue(record?.event) ?? null,
            error: stringValue(record?.error) ?? String(error),
          });
        },
      }),
    );
    return {
      ...session,
      cleanup,
      resolvedModelId: modelConfig.resolvedModelId,
    };
  } catch (error) {
    for (const cleanupFn of cleanup) {
      try {
        await cleanupFn();
      } catch (cleanupError) {
        logger.warn("local Pi SDK session cleanup failed", {
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }
    }
    throw error;
  }
}

interface DesktopExtensionSpec {
  extension: ThinkworkExtension;
  providers?: ProviderBundle;
}

interface DesktopSharedExtensions {
  toolNames: string[];
  extensionFactories: unknown[];
  customTools: unknown[];
}

async function createDesktopSharedExtensions(
  sdk: PiSdkModuleLike,
  prepared: PreparedDesktopPiRuntimeSession,
  logger: RedactedLogger,
  fetchImpl: typeof fetch,
  connectMcpServerOverride: DesktopConnectMcpServerFn | undefined,
  cleanup: Array<() => Promise<void>>,
  mcpAdapterConfig: DesktopMcpAdapterConfig | null,
): Promise<DesktopSharedExtensions> {
  const { invocation } = prepared;
  const specs: DesktopExtensionSpec[] = [];
  const canLoadExtensions =
    Boolean(sdk.DefaultResourceLoader) || typeof sdk.defineTool === "function";

  if (!canLoadExtensions) {
    return {
      toolNames: [],
      extensionFactories: [],
      customTools: [],
    };
  }

  const addExtension = (
    extension: ThinkworkExtension,
    providers?: ProviderBundle,
  ) => {
    if ((extension.toolNames?.length ?? 0) === 0) return;
    specs.push({ extension, providers });
  };

  const webSearchConfig = readWebSearchConfig(invocation.web_search_config);
  if (webSearchConfig) {
    addExtension(createWebSearchExtension({ webSearchConfig, fetchImpl }));
  }

  if (invocation.browser_automation_enabled === true) {
    addExtension(
      createBrowserAutomationExtension({
        enabled: true,
        run: async (request, signal) => {
          if (!isHttpUrl(request.url)) {
            throw new Error("browser_automation requires an http(s) URL");
          }
          if (!request.task) {
            throw new Error("browser_automation requires a non-empty task");
          }
          logger.info("local Pi browser automation started", {
            url: request.url,
            taskChars: request.task.length,
            engine: "desktop_fetch",
          });
          throwIfAborted(signal);
          const result = await runLocalBrowserAutomation({
            url: request.url,
            task: request.task,
            fetchImpl,
          });
          logger.info("local Pi browser automation completed", {
            url: request.url,
            title: result.title,
            textChars: result.text.length,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            details: result,
          };
        },
      }),
    );
  }

  const apiUrl = stringValue(invocation.thinkwork_api_url)?.replace(/\/+$/, "");
  const threadTurnId = stringValue(invocation.thread_turn_id);
  const finalizeToken = stringValue(invocation.finalize_callback_secret);
  if (invocation.context_engine_enabled === true && apiUrl && finalizeToken) {
    addExtension(
      createContextEngineExtension({
        enabled: true,
        apiUrl,
        apiSecret: finalizeToken,
        tenantId: invocation.tenant_id,
        userId: invocation.user_id,
        agentId: invocation.assistant_id,
        threadTurnId,
        contextEngineConfig: readRecord(invocation.context_engine_config) ?? {},
        fetchImpl,
      }),
    );
  }

  const sendEmailConfig = readRecord(invocation.send_email_config);
  if (sendEmailConfig && apiUrl && finalizeToken) {
    addExtension(
      createSendEmailExtension({
        sendEmailConfig: {
          ...sendEmailConfig,
          apiUrl: stringValue(sendEmailConfig.apiUrl) ?? apiUrl,
          apiSecret: stringValue(sendEmailConfig.apiSecret) ?? finalizeToken,
          threadTurnId,
        },
        payload: invocation,
        fetchImpl,
      }),
    );
  }

  if (hindsightEnabled(prepared)) {
    addExtension(
      createMemoryExtension({
        groundingQuery: invocation.message,
        onError: (error, context) =>
          logger.warn("local Pi memory extension warning", {
            phase: context.phase,
            error: error instanceof Error ? error.message : String(error),
          }),
      }),
      {
        memory: createDesktopHindsightMemoryProvider(
          prepared,
          fetchImpl,
          logger,
        ),
      },
    );
  }

  const managedDelegation = createManagedDelegationClient({
    apiUrl: invocation.thinkwork_api_url,
    parentThreadTurnId: invocation.thread_turn_id,
    finalizeCallbackSecret: invocation.finalize_callback_secret,
  });
  addExtension(createDelegationExtension(), {
    delegation: {
      async delegate(request) {
        logger.info("local Pi managed delegation requested", {
          visibility: request.visibility ?? "hidden",
          hasTask: request.task.length > 0,
          hasReason: typeof request.reason === "string",
          timeoutMs: request.timeoutMs ?? null,
        });
        const result = await managedDelegation.delegate(request);
        logger.info("local Pi managed delegation completed", {
          visibility: request.visibility ?? "hidden",
          resultStatus: stringValue(readRecord(result)?.status) ?? "unknown",
        });
        return result;
      },
    },
  });

  const extensions = specs.map((spec) => spec.extension);
  const mcpTools = connectMcpServerOverride
    ? await buildDesktopMcpTools({
        sdk,
        invocation,
        logger,
        fetchImpl,
        cleanup,
        connectMcpServer: connectMcpServerOverride,
      })
    : [];
  const registerMcpAdapter = Boolean(
    mcpAdapterConfig && sdk.DefaultResourceLoader,
  );
  const toolNames = [
    ...collectExtensionToolNames(extensions),
    ...(registerMcpAdapter ? ["mcp"] : []),
    ...mcpTools.map((tool) => tool.name),
  ];
  const extensionFactories = sdk.DefaultResourceLoader
    ? specs.map((spec) =>
        toExtensionFactory(spec.extension, spec.providers ?? {}),
      )
    : [];
  const customTools = [
    ...(sdk.DefaultResourceLoader
      ? []
      : materializeExtensionCustomTools(sdk, specs)),
    ...mcpTools.map((tool) => defineDesktopTool(sdk, tool)),
  ];

  return { toolNames, extensionFactories, customTools };
}

function materializeExtensionCustomTools(
  sdk: PiSdkModuleLike,
  specs: DesktopExtensionSpec[],
): unknown[] {
  if (typeof sdk.defineTool !== "function") return [];
  const customTools: unknown[] = [];
  const pi = {
    registerTool(tool: Record<string, unknown>) {
      customTools.push(sdk.defineTool?.(tool) ?? tool);
    },
    on() {
      return undefined;
    },
  };

  for (const spec of specs) {
    const result = spec.extension.register(
      pi as unknown as Parameters<ThinkworkExtension["register"]>[0],
      spec.providers ?? {},
    );
    if (result && typeof (result as Promise<void>).then === "function") {
      throw new Error(
        `Desktop fallback cannot synchronously materialize extension "${spec.extension.name}".`,
      );
    }
  }
  return customTools;
}

interface DesktopMcpAdapterConfig {
  configPath: string;
  extensionPath: string;
  envKeys: string[];
  serverCount: number;
}

async function prepareDesktopMcpAdapter(args: {
  agentDir: string;
  invocation: PreparedDesktopPiRuntimeSession["invocation"];
  logger: RedactedLogger;
  cleanup: Array<() => Promise<void>>;
}): Promise<DesktopMcpAdapterConfig | null> {
  const configs = parseDesktopMcpConfigs(args.invocation.mcp_configs);
  if (configs.length === 0) return null;

  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = args.agentDir;
  const envKeys: string[] = [];
  const mcpServers: Record<string, Record<string, unknown>> = {};

  for (const [index, config] of configs.entries()) {
    const validation = validateDesktopMcpUrl(config.url);
    if (!validation.ok) {
      args.logger.warn("local Pi MCP adapter URL rejected", {
        serverName: config.serverName,
        rejectionReason: validation.reason,
      });
      continue;
    }
    if (config.toolWhitelist?.length && !config.allowlistEnforced) {
      args.logger.warn("local Pi MCP adapter allowlist rejected", {
        serverName: config.serverName,
        rejectionReason: "missing-cached-tool-inventory",
      });
      continue;
    }
    const envKey = `THINKWORK_DESKTOP_MCP_${sanitizeMcpToolName(
      config.serverName,
    ).toUpperCase()}_${index}_${randomUUID().replaceAll("-", "").toUpperCase()}`;
    process.env[envKey] = config.bearer;
    envKeys.push(envKey);
    mcpServers[config.serverName] = {
      url: config.url,
      auth: "bearer",
      bearerTokenEnv: envKey,
      lifecycle: "lazy",
      directTools: false,
      exposeResources: false,
      ...(config.excludedTools.length > 0
        ? { excludeTools: config.excludedTools }
        : {}),
    };
  }

  if (Object.keys(mcpServers).length === 0) {
    restoreMcpAdapterEnv(previousAgentDir, envKeys);
    return null;
  }

  await mkdir(args.agentDir, { recursive: true });
  const extensionDir = path.join(args.agentDir, "extensions");
  await mkdir(extensionDir, { recursive: true });
  const extensionPath = path.join(extensionDir, "thinkwork-mcp-adapter.ts");
  await writeFile(
    extensionPath,
    [
      `import mcpAdapter from ${JSON.stringify(PI_MCP_ADAPTER_ENTRY)};`,
      "",
      "export default mcpAdapter;",
      "",
    ].join("\n"),
    "utf8",
  );
  const configPath = path.join(args.agentDir, "mcp.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        settings: {
          toolPrefix: "server",
          directTools: false,
          disableProxyTool: false,
          autoAuth: false,
          authRequiredMessage:
            "This MCP server is authenticated by ThinkWork. Reconnect the connector if authentication fails.",
        },
        mcpServers,
      },
      null,
      2,
    ),
    "utf8",
  );
  args.cleanup.push(async () => {
    restoreMcpAdapterEnv(previousAgentDir, envKeys);
  });
  args.logger.info("local Pi MCP adapter configured", {
    configPath,
    extensionPath,
    serverCount: Object.keys(mcpServers).length,
  });
  return {
    configPath,
    extensionPath,
    envKeys,
    serverCount: Object.keys(mcpServers).length,
  };
}

function restoreMcpAdapterEnv(
  previousAgentDir: string | undefined,
  envKeys: string[],
): void {
  for (const key of envKeys) {
    delete process.env[key];
  }
  if (previousAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
}

interface DesktopMcpConfig {
  serverName: string;
  url: string;
  bearer: string;
  transport?: "streamable-http" | "sse";
  toolWhitelist?: string[];
  excludedTools: string[];
  allowlistEnforced: boolean;
}

interface DesktopMcpTool {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  executionMode: "sequential";
  execute: (toolCallId: string, params: unknown) => Promise<unknown>;
}

interface DesktopConnectMcpServerArgs {
  url: string;
  headers: Record<string, string>;
  serverName: string;
  toolWhitelist?: string[];
  transport?: "streamable-http" | "sse";
}

type DesktopConnectMcpServerFn = (
  args: DesktopConnectMcpServerArgs,
) => Promise<DesktopMcpTool[]>;

interface BuildDesktopMcpToolsOptions {
  sdk: PiSdkModuleLike;
  invocation: PreparedDesktopPiRuntimeSession["invocation"];
  logger: RedactedLogger;
  fetchImpl: typeof fetch;
  cleanup: Array<() => Promise<void>>;
  connectMcpServer: DesktopConnectMcpServerFn;
}

const MCP_HANDLE_AUTH_SCHEME = "Handle";
const MCP_LIST_TOOLS_TIMEOUT_MS = 30_000;
const MCP_CALL_TOOL_TIMEOUT_MS = 60_000;

async function buildDesktopMcpTools(
  options: BuildDesktopMcpToolsOptions,
): Promise<DesktopMcpTool[]> {
  const configs = parseDesktopMcpConfigs(options.invocation.mcp_configs);
  if (configs.length === 0) return [];

  const handleStore = new Map<string, string>();
  options.cleanup.push(async () => {
    handleStore.clear();
  });
  const connectMcpServer =
    options.connectMcpServer ??
    createDesktopConnectMcpServer({
      cleanup: options.cleanup,
      fetchImpl: createDesktopMcpFetch(handleStore, options.fetchImpl),
    });
  const tools: DesktopMcpTool[] = [];

  for (const config of configs) {
    const validation = validateDesktopMcpUrl(config.url);
    if (!validation.ok) {
      options.logger.warn("local Pi MCP URL rejected", {
        serverName: config.serverName,
        rejectionReason: validation.reason,
      });
      continue;
    }

    const handle = randomUUID();
    handleStore.set(handle, config.bearer);
    try {
      const serverTools = await connectMcpServer({
        url: config.url,
        headers: {
          Authorization: `${MCP_HANDLE_AUTH_SCHEME} ${handle}`,
        },
        serverName: config.serverName,
        toolWhitelist: config.toolWhitelist,
        transport: config.transport,
      });
      tools.push(...serverTools);
      options.logger.info("local Pi MCP server connected", {
        serverName: config.serverName,
        toolCount: serverTools.length,
      });
    } catch (err) {
      handleStore.delete(handle);
      options.logger.warn("local Pi MCP connect failed", {
        serverName: config.serverName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return tools;
}

function defineDesktopTool(
  sdk: PiSdkModuleLike,
  tool: DesktopMcpTool,
): unknown {
  return sdk.defineTool?.(tool as unknown as Record<string, unknown>) ?? tool;
}

function parseDesktopMcpConfigs(value: unknown): DesktopMcpConfig[] {
  if (!Array.isArray(value)) return [];
  const out: DesktopMcpConfig[] = [];
  for (const item of value) {
    const record = readRecord(item);
    if (!record) continue;
    const auth = readRecord(record.auth);
    const bearer = stringValue(auth?.token);
    const serverName =
      stringValue(record.name) ?? stringValue(record.serverName) ?? "";
    const url = stringValue(record.url) ?? "";
    if (!serverName || !url || !bearer) continue;
    const transport =
      record.transport === "sse" || record.transport === "streamable-http"
        ? record.transport
        : undefined;
    const toolWhitelist = Array.isArray(record.tools)
      ? record.tools.filter((tool): tool is string => typeof tool === "string")
      : undefined;
    const knownToolNames = desktopMcpCachedToolNames(record);
    out.push({
      serverName,
      url,
      bearer,
      transport,
      toolWhitelist,
      excludedTools: excludedDesktopMcpTools(toolWhitelist, knownToolNames),
      allowlistEnforced:
        !toolWhitelist ||
        toolWhitelist.length === 0 ||
        knownToolNames.length > 0,
    });
  }
  return out;
}

function desktopMcpCachedToolNames(record: Record<string, unknown>): string[] {
  const availableTools = Array.isArray(record.availableTools)
    ? record.availableTools
    : [];
  const discoveredTools = Array.isArray(record.discoveredTools)
    ? record.discoveredTools
    : [];
  const allTools = Array.isArray(record.allTools) ? record.allTools : [];
  const cachedToolNames =
    availableTools.length > 0 || discoveredTools.length > 0
      ? [...availableTools, ...discoveredTools]
      : allTools;

  const names = cachedToolNames
    .map((tool) => {
      if (typeof tool === "string") return tool;
      const toolRecord = readRecord(tool);
      return stringValue(toolRecord?.name);
    })
    .filter((name): name is string => Boolean(name));

  return [...new Set(names)];
}

function excludedDesktopMcpTools(
  toolWhitelist: string[] | undefined,
  knownToolNames: string[],
): string[] {
  if (!toolWhitelist || toolWhitelist.length === 0) return [];
  const allowlist = new Set(toolWhitelist);
  return knownToolNames.filter((name) => !allowlist.has(name));
}

function createDesktopConnectMcpServer(options: {
  cleanup: Array<() => Promise<void>>;
  fetchImpl: typeof fetch;
}): DesktopConnectMcpServerFn {
  return async function connectMcpServer(
    args: DesktopConnectMcpServerArgs,
  ): Promise<DesktopMcpTool[]> {
    const transport = createDesktopMcpTransport({
      url: new URL(args.url),
      headers: args.headers,
      transport: args.transport ?? "streamable-http",
      fetchImpl: options.fetchImpl,
    });
    const client = new Client({
      name: "thinkwork-desktop-pi",
      version: "0.0.0",
    });
    await client.connect(transport);
    options.cleanup.push(async () => {
      await transport.close();
    });

    const listing = await client.listTools(undefined, {
      timeout: MCP_LIST_TOOLS_TIMEOUT_MS,
    });
    const allowlist = args.toolWhitelist?.length
      ? new Set(args.toolWhitelist)
      : null;
    return listing.tools
      .filter((tool) => !allowlist || allowlist.has(tool.name))
      .map((tool): DesktopMcpTool => {
        const name = exposedDesktopMcpToolName(args.serverName, tool.name);
        return {
          name,
          label: `${args.serverName}: ${tool.name}`,
          description: [
            `Call the ${tool.name} MCP tool on ${args.serverName}.`,
            tool.description ?? "",
          ]
            .filter(Boolean)
            .join(" "),
          parameters: schemaForMcpTool(tool.inputSchema),
          executionMode: "sequential",
          execute: async (_toolCallId, params) => {
            const response = await client.callTool(
              {
                name: tool.name,
                arguments: paramsRecord(params),
              },
              undefined,
              { timeout: MCP_CALL_TOOL_TIMEOUT_MS },
            );
            const content =
              "content" in response ? response.content : response.toolResult;
            const text = textFromMcpContent(content);
            if ("isError" in response && response.isError) {
              throw new Error(text || `MCP tool ${tool.name} returned isError`);
            }
            return {
              content: [{ type: "text", text }],
              details: {
                server_name: args.serverName,
                mcp_server: args.serverName,
                mcp_tool_name: tool.name,
                exposed_tool_name: name,
                raw: response,
              },
            };
          },
        };
      });
  };
}

function createDesktopMcpTransport(args: {
  url: URL;
  headers: Record<string, string>;
  transport: "streamable-http" | "sse";
  fetchImpl: typeof fetch;
}): Transport {
  const requestInit: RequestInit = { headers: args.headers };
  if (args.transport === "sse") {
    return new SSEClientTransport(args.url, {
      requestInit,
      eventSourceInit: requestInit as never,
      fetch: args.fetchImpl,
    });
  }
  return new StreamableHTTPClientTransport(args.url, {
    requestInit,
    fetch: args.fetchImpl,
  });
}

function createDesktopMcpFetch(
  handleStore: Map<string, string>,
  fetchImpl: typeof fetch,
): typeof fetch {
  const handlePrefix = `${MCP_HANDLE_AUTH_SCHEME} `;
  return async function desktopMcpFetch(input, init) {
    const headers = flattenHeaders(init?.headers);
    const authKey = findHeaderKey(headers, "authorization");
    if (authKey && headers[authKey]?.startsWith(handlePrefix)) {
      const handle = headers[authKey].slice(handlePrefix.length).trim();
      const bearer = handleStore.get(handle);
      if (!bearer) throw new Error("MCP auth handle is no longer available");
      headers.Authorization = `Bearer ${bearer}`;
      if (authKey !== "Authorization") delete headers[authKey];
      return fetchImpl(input, { ...(init ?? {}), headers });
    }
    return fetchImpl(input, init);
  };
}

function flattenHeaders(
  headers: HeadersInit | undefined,
): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function findHeaderKey(
  headers: Record<string, string>,
  wanted: string,
): string | undefined {
  const lower = wanted.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === lower);
}

function exposedDesktopMcpToolName(
  serverName: string,
  toolName: string,
): string {
  return `mcp_${sanitizeMcpToolName(serverName)}_${sanitizeMcpToolName(toolName)}`.slice(
    0,
    64,
  );
}

function sanitizeMcpToolName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object"
    ? (params as Record<string, unknown>)
    : {};
}

function schemaForMcpTool(schema: unknown): TSchema {
  if (
    schema &&
    typeof schema === "object" &&
    (schema as { type?: unknown }).type === "object"
  ) {
    return schema as TSchema;
  }
  return Type.Object({});
}

function textFromMcpContent(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (record.resource && typeof record.resource === "object") {
        const resource = record.resource as Record<string, unknown>;
        if (typeof resource.text === "string") return resource.text;
        if (typeof resource.uri === "string") return resource.uri;
      }
      if (typeof record.uri === "string") return record.uri;
      return JSON.stringify(record);
    })
    .filter(Boolean)
    .join("\n");
}

function validateDesktopMcpUrl(
  url: string,
): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "unsupported-scheme" };
  }
  const host = parsed.hostname.replace(/\.+$/, "").toLowerCase();
  if (!host) return { ok: false, reason: "invalid-url" };
  if (host === "localhost" || host.endsWith(".localhost")) {
    return { ok: false, reason: "loopback-host" };
  }
  const unbracketed =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const family = isIP(unbracketed);
  if (family === 4) {
    const parts = unbracketed.split(".").map((part) => Number(part));
    const [a, b] = parts;
    if (a === 127) return { ok: false, reason: "loopback-host" };
    if (a === 169 && b === 254) return { ok: false, reason: "link-local-host" };
    if (
      a === 10 ||
      (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b !== undefined && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a === 0
    ) {
      return { ok: false, reason: "private-host" };
    }
  }
  if (family === 6) {
    if (
      unbracketed === "::1" ||
      unbracketed === "::" ||
      /^fe[89ab][0-9a-f]?:/i.test(unbracketed) ||
      /^fc[0-9a-f]{0,2}:|^fd[0-9a-f]{0,2}:/i.test(unbracketed)
    ) {
      return { ok: false, reason: "private-host" };
    }
  }
  return { ok: true };
}

function hindsightEnabled(prepared: PreparedDesktopPiRuntimeSession): boolean {
  const sidecarHindsight = readRecord(
    readRecord(prepared.sidecarCredentials)?.hindsight,
  );
  const endpoint =
    stringValue(prepared.invocation.hindsight_endpoint) ??
    stringValue(sidecarHindsight?.endpoint);
  return prepared.invocation.use_memory !== false && Boolean(endpoint);
}

function createDesktopHindsightMemoryProvider(
  prepared: PreparedDesktopPiRuntimeSession,
  fetchImpl: typeof fetch,
  logger: RedactedLogger,
): MemoryProvider {
  const sidecarHindsight = readRecord(
    readRecord(prepared.sidecarCredentials)?.hindsight,
  );
  const endpoint =
    stringValue(prepared.invocation.hindsight_endpoint) ??
    stringValue(sidecarHindsight?.endpoint);
  const tenantId = prepared.invocation.tenant_id;
  const userId = prepared.invocation.user_id;
  if (!endpoint || !tenantId || !userId) {
    throw new Error("Desktop Hindsight memory provider is missing scope.");
  }
  const bankId = `user_${userId}`;
  const postJson = async (
    route: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> => {
    const response = await fetchImpl(`${endpoint.replace(/\/$/, "")}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Hindsight ${response.status}: ${text.slice(0, 400)}`);
    }
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { text };
    }
  };

  logger.info("local Pi memory extension enabled", {
    tenantId,
    bankId,
  });

  return {
    async recall(request, signal) {
      const query = request.query?.trim();
      if (!query) throw new Error("recall called with an empty query.");
      const data = await postJson(
        `/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`,
        {
          query,
          budget: "low",
          max_tokens: HINDSIGHT_RECALL_MAX_TOKENS,
          include: { entities: null },
          types: ["world", "experience", "observation"],
        },
        signal,
      );
      const memories = toMemoryItems(data);
      return {
        memories: request.limit ? memories.slice(0, request.limit) : memories,
        usage: data.usage,
      };
    },
    async reflect(request, signal) {
      const query = request.query?.trim();
      if (!query) throw new Error("reflect called with an empty query.");
      const data = await postJson(
        `/v1/default/banks/${encodeURIComponent(bankId)}/reflect`,
        { query, budget: "mid" },
        signal,
      );
      return {
        ok: true,
        text: firstString(data, ["text", "response", "summary", "answer"]),
        usage: data.usage,
      };
    },
  };
}

function toMemoryItems(data: Record<string, unknown>) {
  const raw = Array.isArray(data.memory_units)
    ? data.memory_units
    : Array.isArray(data.memories)
      ? data.memories
      : Array.isArray(data.results)
        ? data.results
        : [];
  return raw
    .map((unit, index) => {
      const record = readRecord(unit) ?? {};
      const content =
        typeof unit === "string"
          ? unit.trim()
          : firstString(record, ["text", "content", "summary", "value"]);
      if (!content) return null;
      return {
        id:
          stringValue(record.id) ??
          stringValue(record.memory_unit_id) ??
          `unit-${index}`,
        content,
        ...(typeof record.score === "number" ? { score: record.score } : {}),
      };
    })
    .filter((item): item is { id: string; content: string; score?: number } =>
      Boolean(item),
    );
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return undefined;
}

function createPiSdkModelConfig(
  sdk: PiSdkModuleLike,
  invocation: PreparedDesktopPiRuntimeSession["invocation"],
  logger: RedactedLogger,
): { options: Record<string, unknown>; resolvedModelId?: string } {
  if (!sdk.AuthStorage?.create || !sdk.ModelRegistry?.create) {
    return { options: {} };
  }
  const authStorage = sdk.AuthStorage.create();
  primeBedrockRuntimeAuth(authStorage, logger);
  const modelRegistry = sdk.ModelRegistry.create(authStorage);
  const requestedModelId = stringValue(invocation.model);
  const requestedBedrockModel =
    requestedModelId && isLikelyBedrockModelId(requestedModelId)
      ? modelRegistry.find("amazon-bedrock", requestedModelId)
      : undefined;
  const model =
    requestedBedrockModel ??
    modelRegistry.find("amazon-bedrock", DEFAULT_BEDROCK_MODEL_ID);

  if (!model) {
    logger.warn("local Pi Bedrock model unavailable in SDK registry", {
      requestedModelId: requestedModelId ?? null,
      fallbackModelId: DEFAULT_BEDROCK_MODEL_ID,
    });
    return { options: { authStorage, modelRegistry } };
  }

  if (!requestedBedrockModel && requestedModelId) {
    logger.info("local Pi model routed to Bedrock fallback", {
      requestedModelId,
      fallbackModelId: DEFAULT_BEDROCK_MODEL_ID,
    });
  }

  return {
    options: { authStorage, modelRegistry, model },
    resolvedModelId: stringValue(readRecord(model)?.id),
  };
}

function primeBedrockRuntimeAuth(
  authStorage: PiSdkAuthStorageLike,
  logger: RedactedLogger,
): void {
  if (typeof authStorage.setRuntimeApiKey !== "function") return;
  authStorage.setRuntimeApiKey(
    "amazon-bedrock",
    stringValue(process.env.AWS_BEARER_TOKEN_BEDROCK) ??
      "aws-sdk-default-credential-chain",
  );
  logger.info("local Pi Bedrock runtime auth primed", {
    source: process.env.AWS_BEARER_TOKEN_BEDROCK
      ? "bearer-token-env"
      : "aws-sdk-default-credential-chain",
  });
}

function isLikelyBedrockModelId(modelId: string): boolean {
  const normalized = modelId.trim();
  return (
    normalized.startsWith("arn:aws:bedrock:") ||
    normalized.startsWith("amazon.") ||
    normalized.startsWith("anthropic.") ||
    normalized.startsWith("cohere.") ||
    normalized.startsWith("deepseek.") ||
    normalized.startsWith("meta.") ||
    normalized.startsWith("mistral.") ||
    normalized.startsWith("us.") ||
    normalized.startsWith("eu.") ||
    normalized.startsWith("apac.") ||
    normalized.startsWith("global.")
  );
}

async function syncLocalPiAgentPromptFiles(args: {
  invocation: DesktopPiRuntimeInvocation;
  workspaceDir: string;
  agentDir: string;
  systemPrompt: string;
  logger: RedactedLogger;
}): Promise<void> {
  await mkdir(args.agentDir, { recursive: true });
  const promptFiles = await collectPromptSourceFiles(args.workspaceDir);
  const byBasename = new Map<string, PromptSourceFile>();
  for (const filename of PROMPT_SOURCE_FILENAMES) {
    const exact = promptFiles.find((file) => file.relativePath === filename);
    const nested = promptFiles.find(
      (file) => path.basename(file.relativePath) === filename,
    );
    const selected = exact ?? nested;
    if (selected) byBasename.set(filename, selected);
  }

  const filesToWrite: Record<string, string> = {
    "AGENTS.md":
      byBasename.get("AGENTS.md")?.content ??
      renderFallbackAgentsMd(args.systemPrompt),
    "SPACE.md":
      byBasename.get("SPACE.md")?.content ?? renderFallbackSpaceMd(args),
    "USER.md": byBasename.get("USER.md")?.content ?? renderFallbackUserMd(args),
    "PROMPT_SOURCES.md": renderPromptSourceIndex(promptFiles),
  };

  for (const [filename, content] of Object.entries(filesToWrite)) {
    await writeFile(path.join(args.agentDir, filename), content, "utf8");
  }

  args.logger.info("local Pi agent prompt files synced", {
    agentDir: args.agentDir,
    promptFileCount: promptFiles.length,
    agentFiles: Object.keys(filesToWrite),
    selectedPromptFiles: [...byBasename.values()].map(
      (file) => file.relativePath,
    ),
  });
}

function renderFallbackAgentsMd(systemPrompt: string): string {
  return [
    "# AGENTS.md",
    "",
    "This file was generated for the desktop local Pi runtime from the composed ThinkWork system prompt because no rendered AGENTS.md file was available in the local workspace.",
    "",
    "## Composed System Prompt",
    "",
    "```text",
    systemPrompt,
    "```",
    "",
  ].join("\n");
}

function renderFallbackSpaceMd(args: {
  invocation: DesktopPiRuntimeInvocation;
}): string {
  const context = readRecord(args.invocation.turn_context);
  return [
    "# SPACE.md",
    "",
    "No rendered SPACE.md file was available in the local workspace.",
    "",
    `- Space: ${stringValue(context?.spaceSlug) ?? stringValue(context?.spaceId) ?? "unknown"}`,
    `- Agent: ${args.invocation.agent_name ?? args.invocation.instance_id ?? "unknown"}`,
    "",
  ].join("\n");
}

function renderFallbackUserMd(args: {
  invocation: DesktopPiRuntimeInvocation;
}): string {
  return [
    "# USER.md",
    "",
    "No rendered USER.md file was available in the local workspace.",
    "",
    `- Human: ${args.invocation.human_name ?? "unknown"}`,
    `- Email: ${args.invocation.current_user_email ?? "unknown"}`,
    "",
  ].join("\n");
}

function renderPromptSourceIndex(promptFiles: PromptSourceFile[]): string {
  return [
    "# Prompt Sources",
    "",
    "Prompt source files discovered in the rendered workspace and mirrored into the local Pi agent directory.",
    "",
    ...(promptFiles.length > 0
      ? promptFiles.map(
          (file) =>
            `- ${file.relativePath} (${file.content.length} chars, sha256 ${file.sha256})`,
        )
      : ["- No AGENTS.md, SPACE.md, or USER.md files were found."]),
    "",
  ].join("\n");
}

function buildSystemPrompt(invocation: DesktopPiRuntimeInvocation): string {
  const base = invocation.system_prompt?.trim() || "You are ThinkWork Pi.";
  return `${base}

You are running inside the ThinkWork desktop local Pi sidecar.
Use only the rendered app workspace mounted as the current working directory.
The SDK agent directory is .thinkwork-pi; it contains local copies of AGENTS.md, SPACE.md, USER.md, and PROMPT_SOURCES.md for this turn.
Use bash for shell commands, repository work, package scripts, builds, tests, and command output inside the rendered app workspace.
Do not attempt to read arbitrary local folders, access the clipboard, or use screenshots.
Use web_search for current facts and browser_automation for inspecting a specific public page when those tools are available.
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
      if (entry.name === LOCAL_PI_AGENT_DIR) continue;
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
  resolvedModelId?: string,
  diagnostics?: Record<string, unknown>,
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
      resolvedModelId ??
      invocation.model ??
      "desktop-local-pi",
    toolsCalled: toolNames,
    toolInvocations,
    diagnostics,
  };
}

type WebSearchProvider = "exa" | "serpapi";

interface LocalWebSearchConfig {
  provider: WebSearchProvider;
  apiKey: string;
}

interface LocalBrowserAutomationResult {
  url: string;
  title: string;
  task: string;
  text: string;
}

async function runLocalBrowserAutomation(args: {
  url: string;
  task: string;
  fetchImpl: typeof fetch;
}): Promise<LocalBrowserAutomationResult> {
  const response = await args.fetchImpl(args.url, {
    headers: { "User-Agent": "Thinkwork/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `Browser Automation ${response.status}: ${raw.slice(0, 200)}`,
    );
  }
  const title = extractHtmlTitle(raw) ?? args.url;
  const text = contentType.includes("html")
    ? extractReadableHtmlText(raw)
    : cleanSearchText(raw);
  return {
    url: args.url,
    title,
    task: args.task,
    text: (text ?? "").slice(0, 8_000),
  };
}

function readWebSearchConfig(value: unknown): LocalWebSearchConfig | null {
  const record = readRecord(value);
  if (!record) return null;
  const provider = record.provider === "serpapi" ? "serpapi" : "exa";
  const apiKey = stringValue(record.apiKey);
  return apiKey ? { provider, apiKey } : null;
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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(stripTags(match[1]).trim()) : null;
}

function extractReadableHtmlText(html: string): string | undefined {
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  return cleanSearchText(decodeHtmlEntities(stripTags(withoutNoise)));
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "turn";
}

async function finalizeTurn(args: {
  prepared: PreparedDesktopPiRuntimeSession;
  status: "ok" | "error";
  runResult?: RunAgentLoopResult;
  error?: unknown;
  systemPrompt?: string;
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
    systemPrompt: args.systemPrompt ?? args.prepared.invocation.system_prompt,
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
