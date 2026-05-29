import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
// Type-only imports: erased at runtime, so importing the heavy coding-agent
// package (TUI components, interactive mode) has zero load-time side effects in
// the headless container, while `typeof import(...)` below keeps the call shape
// type-checked at build (SDK drift fails the build, not first invocation).
import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import {
  openDurableSession,
  SessionConflictError,
  type SessionLog,
  type SessionStore,
} from "./durable-session-manager.js";
import { textFromAssistant } from "./history.js";
import { collectToolCosts } from "./tool-costs.js";
import type { RunAgentLoopArgs, RunAgentLoopResult } from "./types.js";

/**
 * Full Pi built-in tool set. We pass an explicit allowlist so all seven are
 * active in the cloud sandbox — "leverage built-ins, disable nothing"
 * (feedback_pi_leverage_builtin_tools). Note: when `tools` is provided to
 * `createAgentSession` it is an allowlist that gates BOTH built-ins and custom
 * tools, so our platform tool names are appended in `buildToolAllowlist`.
 */
export const BUILTIN_TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

const DEFAULT_BEDROCK_MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const PI_AGENT_DIR = ".thinkwork-pi";

type PiCodingAgentModule = typeof import("@earendil-works/pi-coding-agent");

/** Minimal slice of `AgentSession` the loop drives. Keeps the test seam small. */
export interface AgentSessionLike {
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string, options?: Record<string, unknown>): Promise<void>;
  readonly messages: AgentMessage[];
  dispose(): void;
}

export interface OpenedSession {
  session: AgentSessionLike;
  /** Model id actually resolved for this turn (for the result `modelId`). */
  modelId: string;
  /** Present when a durable per-thread session backs this turn. Resumes prior
   *  context from storage, so the loop sends only the new message (no text
   *  history prepend). Call after a successful turn to persist the session. */
  persistSession?: () => Promise<void>;
  /** True when a durable session is active (resumed or freshly seeded), so the
   *  loop must NOT prepend conversation text — the session carries context. */
  durable?: boolean;
}

export interface RunAgentLoopDeps {
  /**
   * Opens the agent session for a turn. Defaults to the real
   * `createAgentSession` path (Bedrock auth + model registry + resource loader
   * + in-memory session). Injected in tests so the deterministic orchestration
   * (tool adaptation, allowlist, event collection, result extraction) can be
   * verified without a live model.
   */
  openSession?: (inputs: OpenSessionInputs) => Promise<OpenedSession>;
  /** Optional structured logger for durable-session lifecycle + persist
   *  failures. No-op by default. */
  log?: SessionLog;
}

export interface OpenSessionInputs {
  cwd: string;
  systemPrompt: string;
  modelId: string;
  toolAllowlist: string[];
  customTools: ToolDefinition[];
  /** When a store + threadId are present, the turn runs over a durable
   *  per-thread session (resume instead of history replay). */
  sessionStore?: SessionStore;
  threadId?: string;
  /** Local scratch dir for the SDK's session file (defaults under cwd). */
  sessionDir?: string;
  /** Prior conversation, used only to seed a brand-new durable session. */
  seedHistory?: Message[];
  /** Structured logger forwarded to the durable session path. */
  log?: SessionLog;
  /**
   * Pi extension factories the host bound to its provider bundle. Loaded into
   * the resource loader's `extensionFactories` (U1 mechanism) so the extensions'
   * tools/hooks reach the session additively over the built-ins + custom tools.
   */
  extensionFactories?: ExtensionFactory[];
}

function resolveModelIdString(modelId: unknown): string {
  return typeof modelId === "string" && modelId.trim()
    ? modelId.trim()
    : DEFAULT_BEDROCK_MODEL_ID;
}

/** Flatten a pi-ai message to plain text (user content is a string; assistant
 *  content is a `TextContent[]`). */
function messageText(message: Message): string {
  const content: unknown = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part &&
        typeof part === "object" &&
        (part as { type?: string }).type === "text"
          ? ((part as { text?: string }).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

/**
 * Build the prompt sent to `session.prompt()`. Until durable per-thread
 * sessions land (U4), the cloud has no SDK-side transcript to resume, so prior
 * conversation is prepended as text — the same transitional mechanism the
 * desktop host uses (`apps/desktop/.../local-turn-runner.ts buildTurnPrompt`).
 * This preserves multi-turn context; U4 replaces it with session resume.
 */
export function buildTurnPrompt(args: RunAgentLoopArgs): string {
  const history = args.history
    .map((message) => {
      const text = messageText(message).trim();
      return text ? `${message.role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
  const historyBlock = history ? `Prior conversation:\n${history}\n\n` : "";
  return `${historyBlock}Current user message:\n${args.message}`;
}

/** Short, render-safe preview of a tool arg/result for the thread activity UI. */
function toolPreview(value: unknown, max = 600): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, max);
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

/**
 * Adapt a low-level pi-agent-core {@link AgentTool} into a coding-agent
 * {@link ToolDefinition}. `ToolDefinition` is a superset whose extra fields
 * (render hooks, prompt snippets) are optional; in the overlapping surface only
 * `execute` differs — it receives a trailing `ExtensionContext` arg our platform
 * tools ignore, so the wrapper forwards the first four arguments. The return is
 * left unannotated so the compiler keeps checking the shape against SDK drift.
 * This is the transitional bridge: extensions replace these in U5/U7.
 */
export function toToolDefinition(tool: AgentTool<any>): ToolDefinition {
  return {
    name: tool.name,
    label: tool.label ?? tool.name,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.prepareArguments
      ? { prepareArguments: tool.prepareArguments }
      : {}),
    ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
    execute: (toolCallId, params, signal, onUpdate) =>
      tool.execute(toolCallId, params, signal, onUpdate),
  };
}

/**
 * Build the `createAgentSession` tool allowlist. Because the allowlist gates
 * custom tools as well as built-ins, the platform tool names must be appended
 * to the full built-in set. De-duplicated so a custom tool that happens to
 * reuse a built-in name does not appear twice (it would then shadow the
 * built-in by name — acceptable, but the list itself stays unique).
 */
export function buildToolAllowlist(customTools: ToolDefinition[]): string[] {
  return [
    ...new Set([
      ...BUILTIN_TOOL_NAMES,
      ...customTools.map((tool) => tool.name),
    ]),
  ];
}

let sdkModule: Promise<PiCodingAgentModule> | undefined;
function loadSdk(): Promise<PiCodingAgentModule> {
  // Cache the resolved module across warm-container invocations, but reset the
  // cache on rejection so a transient first-import failure (cold-start ESM
  // hiccup, memory pressure) does not poison every subsequent turn with the
  // same rejected promise.
  sdkModule ??= import("@earendil-works/pi-coding-agent").catch((error) => {
    sdkModule = undefined;
    throw error;
  });
  return sdkModule;
}

/**
 * Prime Bedrock runtime auth on the SDK auth storage. Bedrock resolves through
 * the AWS SDK default credential chain in the container; the sentinel value
 * signals that path when no explicit bearer token is present (mirrors the
 * desktop runner).
 */
function primeBedrockRuntimeAuth(authStorage: {
  setRuntimeApiKey(provider: string, apiKey: string): void;
}): void {
  authStorage.setRuntimeApiKey(
    "amazon-bedrock",
    process.env.AWS_BEARER_TOKEN_BEDROCK?.trim() ||
      "aws-sdk-default-credential-chain",
  );
}

async function defaultOpenSession(
  inputs: OpenSessionInputs,
): Promise<OpenedSession> {
  const sdk = await loadSdk();
  const {
    createAgentSession,
    AuthStorage,
    ModelRegistry,
    SessionManager,
    DefaultResourceLoader,
  } = sdk;

  const authStorage = AuthStorage.create();
  primeBedrockRuntimeAuth(authStorage);
  const modelRegistry = ModelRegistry.create(authStorage);
  const model =
    modelRegistry.find("amazon-bedrock", inputs.modelId) ??
    modelRegistry.find("amazon-bedrock", DEFAULT_BEDROCK_MODEL_ID);

  // Transitional system-prompt injection: U6 moves composition into a
  // `before_agent_start` extension hook. Until then, override the resource
  // loader's prompt with our already-composed string (desktop-proven path).
  const agentDir = path.join(inputs.cwd, PI_AGENT_DIR);
  await mkdir(agentDir, { recursive: true });
  const resourceLoader = new DefaultResourceLoader({
    cwd: inputs.cwd,
    agentDir,
    systemPromptOverride: () => inputs.systemPrompt,
    // U5 — load thinkwork capabilities as Pi extensions via factory injection
    // (no filesystem discovery; the U1-resolved serverless mechanism). The host
    // built these closed over its provider bundle. Omitted/empty → no-op.
    ...(inputs.extensionFactories && inputs.extensionFactories.length > 0
      ? { extensionFactories: inputs.extensionFactories }
      : {}),
  });
  await resourceLoader.reload();

  // Durable per-thread session: resume from storage when a store + threadId are
  // available; otherwise fall back to an in-memory session (the loop then
  // prepends conversation text). U4. (const ternary so the manager type infers
  // through from the factories rather than collapsing to SessionManagerLike.)
  const durable =
    inputs.sessionStore && inputs.threadId
      ? await openDurableSession({
          store: inputs.sessionStore,
          threadId: inputs.threadId,
          cwd: inputs.cwd,
          sessionDir:
            inputs.sessionDir ??
            path.join(inputs.cwd, PI_AGENT_DIR, "sessions"),
          seedHistory: inputs.seedHistory,
          factories: {
            open: (file, dir, cwdOverride) =>
              SessionManager.open(file, dir, cwdOverride),
            create: (cwd, dir) => SessionManager.create(cwd, dir),
          },
          log: inputs.log,
        })
      : undefined;
  const sessionManager =
    durable?.sessionManager ?? SessionManager.inMemory(inputs.cwd);

  const { session, extensionsResult } = await createAgentSession({
    cwd: inputs.cwd,
    tools: inputs.toolAllowlist,
    customTools: inputs.customTools,
    resourceLoader,
    sessionManager,
    authStorage,
    modelRegistry,
    ...(model ? { model } : {}),
  });

  // Surface extension load failures loudly. The SDK collects factory/register
  // errors into `extensionsResult.errors` and does NOT throw — without this an
  // extension that fails to register (e.g. a missing provider) would silently
  // drop its tools/hooks while the host's pre-load log still reads "loaded". U5.
  for (const failure of extensionsResult?.errors ?? []) {
    inputs.log?.({
      level: "error",
      event: "extension_load_failed",
      extensionPath: failure.path,
      error: failure.error,
    });
  }

  return {
    session,
    modelId: model?.id ?? inputs.modelId,
    durable: Boolean(durable),
    persistSession: durable ? () => durable.persist() : undefined,
  };
}

export async function runAgentLoop(
  args: RunAgentLoopArgs,
  deps: RunAgentLoopDeps = {},
): Promise<RunAgentLoopResult> {
  const openSession = deps.openSession ?? defaultOpenSession;

  const toolsCalled = new Set<string>();
  const toolInvocations: RunAgentLoopResult["toolInvocations"] = [];

  const customTools = args.tools.map(toToolDefinition);
  const toolAllowlist = buildToolAllowlist(customTools);
  const requestedModelId = resolveModelIdString(args.modelId);

  const { session, modelId, durable, persistSession } = await openSession({
    cwd: args.cwd?.trim() || process.cwd(),
    systemPrompt: args.systemPrompt,
    modelId: requestedModelId,
    toolAllowlist,
    customTools,
    sessionStore: args.sessionStore,
    threadId: args.threadId || undefined,
    sessionDir: args.sessionDir,
    seedHistory: args.history,
    log: deps.log,
    extensionFactories: args.extensionFactories,
  });

  try {
    session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        toolsCalled.add(event.toolName);
        toolInvocations.push({
          id: event.toolCallId,
          name: event.toolName,
          tool_name: event.toolName,
          args: event.args,
          input_preview: toolPreview(event.args),
          status: "running",
          started_at: new Date().toISOString(),
          runtime: "pi",
        });
        return;
      }
      if (event.type === "tool_execution_end") {
        const finished = new Date().toISOString();
        const existing = toolInvocations.find(
          (item) => item.id === event.toolCallId,
        );
        if (existing) {
          existing.result = event.result;
          existing.is_error = event.isError;
          existing.output_preview = toolPreview(event.result);
          existing.status = event.isError ? "error" : "ok";
          existing.finished_at = finished;
        } else {
          toolsCalled.add(event.toolName);
          toolInvocations.push({
            id: event.toolCallId,
            name: event.toolName,
            tool_name: event.toolName,
            result: event.result,
            is_error: event.isError,
            output_preview: toolPreview(event.result),
            status: event.isError ? "error" : "ok",
            finished_at: finished,
            runtime: "pi",
          });
        }
      }
    });

    // A durable session carries prior context (resumed or seeded), so send only
    // the new message. Without one, fall back to prepending conversation text.
    await session.prompt(durable ? args.message : buildTurnPrompt(args));

    // Persist the durable session only after a successful turn — a failed turn
    // leaves the stored session at its prior good state for the retry to resume.
    // Persistence is best-effort: the assistant reply is already valid, so a
    // lost concurrency race (SessionConflictError) or a transient store error
    // must NOT fail the turn and discard the reply. The `If-Match` guard already
    // prevented any clobber; we log loudly and return the content. The next turn
    // resumes the winner's state.
    if (persistSession) {
      try {
        await persistSession();
      } catch (error) {
        deps.log?.({
          level: error instanceof SessionConflictError ? "warn" : "error",
          event:
            error instanceof SessionConflictError
              ? "durable_session_persist_conflict"
              : "durable_session_persist_failed",
          threadId: args.threadId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const assistant = [...session.messages]
      .reverse()
      .find(
        (message): message is AssistantMessage => message.role === "assistant",
      );

    return {
      content: textFromAssistant(assistant),
      usage: assistant?.usage,
      modelId,
      toolsCalled: [...toolsCalled],
      toolInvocations,
      toolCosts: toolInvocations.flatMap((invocation) =>
        collectToolCosts(invocation.result),
      ),
    };
  } finally {
    session.dispose();
  }
}

// Re-export so consumers (and the inert U2 package later) can reference the
// concrete session type without re-importing the SDK.
export type { AgentSession };
