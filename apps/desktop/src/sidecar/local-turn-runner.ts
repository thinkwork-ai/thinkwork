import { mkdir } from "node:fs/promises";
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
}

export interface LocalTurnRunnerResult {
  finalized: boolean;
  status: "completed" | "failed";
  fallbackEligible: boolean;
  workspace?: WorkspaceSyncResult;
}

const READ_ONLY_WORKSPACE_TOOLS = ["read", "grep", "find", "ls"] as const;

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
    throwIfAborted(deps.signal);
    workspace = await prepareWorkspace(payload, deps);
    throwIfAborted(deps.signal);
    const sdk = await (deps.loadPiSdk ?? loadDefaultPiSdk)();
    throwIfAborted(deps.signal);
    sdkSession = await createSdkSession(
      sdk,
      payload.session,
      workspace.localDir,
    );
    unbindAbort = bindAbortSignal(deps.signal, sdkSession.session, logger);
    const prompt = buildTurnPrompt(payload.session.invocation);
    throwIfAborted(deps.signal);
    await sdkSession.session.prompt(prompt, { source: "sdk" });
    throwIfAborted(deps.signal);
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
        systemPromptOverride: () => buildSystemPrompt(invocation),
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
  const delegationTools = createDelegationTools(sdk, managedDelegation);

  return sdk.createAgentSession({
    cwd: workspaceDir,
    tools: [
      ...READ_ONLY_WORKSPACE_TOOLS,
      ...(delegationTools.length > 0 ? ["delegate_to_managed_agent"] : []),
    ],
    customTools: delegationTools,
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

function createDelegationTools(
  sdk: PiSdkModuleLike,
  delegationProvider: DelegationProvider,
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
        const result = await delegationProvider.delegate({
          task,
          visibility,
          reason: typeof params.reason === "string" ? params.reason : undefined,
          timeoutMs:
            typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
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

function buildTurnPrompt(invocation: DesktopPiRuntimeInvocation): string {
  const history = invocation.messages_history
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const historyBlock = history ? `Prior conversation:\n${history}\n\n` : "";
  return `${historyBlock}Current user message:\n${invocation.message}`;
}

function buildRunResult(
  invocation: DesktopPiRuntimeInvocation,
  session: PiSdkSessionLike,
): RunAgentLoopResult {
  const assistant = findLastAssistantMessage(session.messages ?? []);
  const content = assistant ? assistantMessageText(assistant) : "";
  return {
    content,
    usage: readRecord(assistant)?.usage as RunAgentLoopResult["usage"],
    modelId:
      stringValue(readRecord(assistant)?.model) ??
      invocation.model ??
      "desktop-local-pi",
    toolsCalled: [],
    toolInvocations: [],
  };
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

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
