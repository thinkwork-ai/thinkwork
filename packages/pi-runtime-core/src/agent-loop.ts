import { lstat, mkdir, readlink } from "node:fs/promises";
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
import {
  extractRuntimeThreadGenUICandidates,
  mergeFinalThreadGenUIParts,
  normalizeRuntimeThreadGenUIPart,
  threadGenUIActivityEvent,
} from "./genui-runtime.js";
import { textFromAssistant } from "./history.js";
import {
  OKF_WIKI_CONTEXT_TRACE_EVENT_TYPE,
  okfWikiContextTraceFromToolResult,
  okfWikiContextTraceMessage,
} from "./okf-wiki-navigator.js";
import { collectToolCosts } from "./tool-costs.js";
import type {
  AgentProfileRunRecord,
  PiInvocationIdentity,
  RunAgentLoopArgs,
  RunAgentLoopResult,
} from "./types.js";
import type { ModelRoutedToolCallRecord } from "./model-routing-policy.js";

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
  /** Abort the current run and wait for idle (real `AgentSession.abort`).
   *  Optional on the seam so existing fakes stay valid; the loop uses it as
   *  the deterministic ask_user_question turn-end backstop (U5). */
  abort?(): Promise<void>;
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
  /** Post-turn session entries for host-specific extension evidence capture. */
  readSessionEntries?: () => unknown[];
}

function assistantFailureMessage(
  message: AssistantMessage | undefined,
): string | undefined {
  if (!message) return undefined;
  const record = message as { stopReason?: unknown; errorMessage?: unknown };
  if (record.stopReason !== "error") return undefined;
  const detail =
    typeof record.errorMessage === "string" && record.errorMessage.trim()
      ? record.errorMessage.trim()
      : "Pi agent returned an assistant error.";
  return detail;
}

/**
 * A live mid-turn activity event the host can stream to the client (plan
 * 2026-06-03-001). Emitted per tool/skill/phase boundary (Phase 1) and per
 * coalesced text chunk (Phase 2). The host wires this to an HTTP POST against
 * the activity callback; emission is best-effort and MUST NOT throw or block
 * the turn — turn correctness rides on the finalize callback, not on these.
 */
export interface ActivityEmitEvent {
  /** Dedup-contract event type, e.g. "tool_invocation_started". */
  eventType: string;
  /** Human label for the step (e.g. the tool name). */
  message: string;
  /** Step detail; carried verbatim into the client event payload. */
  payload?: Record<string, unknown>;
  /** thread_turn_events stream bucket — "step" for activity. */
  stream?: string;
  level?: string;
  color?: string;
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
  /**
   * Optional live-activity emitter. When present, the loop fires it on each
   * tool boundary (and Phase 2 text chunk) so the host can stream steps to the
   * client mid-turn. Best-effort: the loop guards every call so a throwing or
   * slow emitter can never fail or delay the turn.
   */
  emitActivity?: (event: ActivityEmitEvent) => void;
}

export interface OpenSessionInputs {
  cwd: string;
  /** Private Pi SDK state directory for auth/settings/session scratch. */
  agentDir?: string;
  /**
   * Prebuilt system prompt to override the resource loader's default with. U6
   * makes this optional: when a system-prompt extension composes the prompt via
   * `before_agent_start`, the host omits this and the override is not installed.
   */
  systemPrompt?: string;
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringRecordValue(value: unknown): Record<string, string> {
  const record = recordValue(value);
  if (!record) return {};
  const normalized: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === "string" && raw.trim()) normalized[key] = raw.trim();
  }
  return normalized;
}

function optionalStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return null;
  }
}

/** Tool name the ask_user_question sentinel is honored for. Keep in sync
 *  with ASK_USER_QUESTION_TOOL_NAME in @thinkwork/pi-extensions
 *  ask-user-question (pi-runtime-core does not depend on pi-extensions). */
export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

/**
 * ask_user_question sentinel detection (plan 2026-06-09-005 U5).
 *
 * The ask-user-question extension returns
 * `details.thinkworkAskUserQuestion.endTurn === true` ONLY when the thread is
 * waiting on the USER (intake-confirmed persistence, or a 409 confirming a
 * batch already pending), so observing the flag on a non-error
 * `tool_execution_end` for the ask_user_question tool means the loop must end
 * the turn deterministically — never rely on the model choosing to stop.
 *
 * Only the canonical `details.thinkworkAskUserQuestion` shape is accepted,
 * and callers must also gate on the event's toolName — a third-party/MCP
 * tool result echoing the sentinel must never terminate the turn.
 */
export function askUserQuestionEndTurn(result: unknown): boolean {
  const record = recordValue(result);
  if (!record) return false;
  const sentinel = recordValue(
    recordValue(record.details)?.thinkworkAskUserQuestion,
  );
  return sentinel?.endTurn === true;
}

function findModelRoutingRecord(
  value: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 4) return null;
  const record = recordValue(value);
  if (!record) return null;

  const direct = recordValue(record.modelRouting ?? record.model_routing);
  if (direct) return direct;

  const details = recordValue(record.details);
  const detailsRouting = recordValue(
    details?.modelRouting ?? details?.model_routing,
  );
  if (detailsRouting) return detailsRouting;

  for (const key of ["result", "toolResult", "rawToolResult", "output"]) {
    const nested = findModelRoutingRecord(record[key], depth + 1);
    if (nested) return nested;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  for (const item of content) {
    const itemRecord = recordValue(item);
    const text = optionalStringValue(itemRecord?.text);
    if (!text || text.length > 200_000) continue;
    const parsed = parseJsonRecord(text);
    const nested = findModelRoutingRecord(parsed, depth + 1);
    if (nested) return nested;
  }

  return null;
}

function extractModelRoutingRecord(input: {
  toolCallId: string;
  toolName: string;
  result: unknown;
}): ModelRoutedToolCallRecord | undefined {
  const routing = findModelRoutingRecord(input.result);
  const model = optionalStringValue(routing?.model);
  if (!routing || !model) return undefined;
  const rawRuleSource = recordValue(routing.ruleSource);
  const ruleSourceOwner = optionalStringValue(rawRuleSource?.owner);
  const status = optionalStringValue(routing.status);
  return {
    toolCallId: input.toolCallId,
    toolName: optionalStringValue(routing.toolName) ?? input.toolName,
    match: stringRecordValue(routing.match),
    model,
    ruleSource: {
      ...(optionalStringValue(rawRuleSource?.path)
        ? { path: optionalStringValue(rawRuleSource?.path)! }
        : {}),
      ...(ruleSourceOwner === "agent" ||
      ruleSourceOwner === "space" ||
      ruleSourceOwner === "workspace" ||
      ruleSourceOwner === "user"
        ? { owner: ruleSourceOwner }
        : {}),
      ...(optionalNumberValue(rawRuleSource?.precedence) !== undefined
        ? { precedence: optionalNumberValue(rawRuleSource?.precedence) }
        : {}),
    },
    status:
      status === "rejected" || status === "failed" || status === "completed"
        ? status
        : "completed",
    ...(optionalNumberValue(routing.inputTokens) !== undefined
      ? { inputTokens: optionalNumberValue(routing.inputTokens) }
      : {}),
    ...(optionalNumberValue(routing.outputTokens) !== undefined
      ? { outputTokens: optionalNumberValue(routing.outputTokens) }
      : {}),
    ...(optionalNumberValue(routing.cachedReadTokens) !== undefined
      ? { cachedReadTokens: optionalNumberValue(routing.cachedReadTokens) }
      : {}),
    ...(optionalNumberValue(routing.cachedWriteTokens) !== undefined
      ? { cachedWriteTokens: optionalNumberValue(routing.cachedWriteTokens) }
      : {}),
    ...(optionalNumberValue(routing.totalTokens) !== undefined
      ? { totalTokens: optionalNumberValue(routing.totalTokens) }
      : {}),
    ...(optionalNumberValue(routing.durationMs) !== undefined
      ? { durationMs: optionalNumberValue(routing.durationMs) }
      : {}),
    ...(optionalStringValue(routing.error)
      ? { error: optionalStringValue(routing.error) }
      : {}),
  };
}

function isAgentProfileRunRecord(
  value: unknown,
): value is AgentProfileRunRecord {
  const record = recordValue(value);
  return (
    typeof record?.profileRunId === "string" &&
    typeof record.profileId === "string" &&
    typeof record.profileSlug === "string" &&
    typeof record.profileName === "string" &&
    typeof record.model === "string" &&
    typeof record.status === "string" &&
    typeof record.startedAt === "string" &&
    typeof record.finishedAt === "string" &&
    typeof record.parentThreadTurnId === "string"
  );
}

function findAgentProfileRunRecord(
  value: unknown,
  depth = 0,
): AgentProfileRunRecord | undefined {
  if (depth > 4) return undefined;
  if (isAgentProfileRunRecord(value)) return value;
  const record = recordValue(value);
  if (!record) return undefined;

  for (const key of [
    "agentProfileRun",
    "agent_profile_run",
    "profileRun",
    "profile_run",
  ]) {
    const direct = record[key];
    if (isAgentProfileRunRecord(direct)) return direct;
  }

  for (const key of ["details", "result", "toolResult", "rawToolResult"]) {
    const nested = findAgentProfileRunRecord(record[key], depth + 1);
    if (nested) return nested;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  for (const item of content) {
    const itemRecord = recordValue(item);
    const text = optionalStringValue(itemRecord?.text);
    if (!text || text.length > 200_000) continue;
    const parsed = parseJsonRecord(text);
    const nested = findAgentProfileRunRecord(parsed, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Fire the host's live-activity emitter, swallowing any throw. Best-effort by
 * contract: a faulty or slow emitter must never break or delay the turn (the
 * finalize callback remains the authoritative, complete record).
 */
function emitActivitySafely(
  deps: RunAgentLoopDeps,
  event: ActivityEmitEvent,
): void {
  if (!deps.emitActivity) return;
  try {
    deps.emitActivity(event);
  } catch {
    // swallow — activity streaming is never allowed to affect the turn
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
 * custom tools AND extension-registered tools as well as built-ins (the SDK
 * enables ONLY listed names when an allowlist is provided), all three must be
 * enumerated: the full built-in set, the custom AgentTool names, and the names
 * of tools registered by loaded extensions (declared by the host — extension
 * tools register during load and would otherwise be silently gated out).
 * De-duplicated so a name appearing in more than one source is listed once.
 */
export function buildToolAllowlist(
  customTools: ToolDefinition[],
  extensionToolNames: readonly string[] = [],
  builtinToolNames: readonly string[] = BUILTIN_TOOL_NAMES,
): string[] {
  return [
    ...new Set([
      ...builtinToolNames,
      ...customTools.map((tool) => tool.name),
      ...extensionToolNames,
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

  // System-prompt source: when the host passes a prebuilt `systemPrompt`,
  // override the resource loader's default with it (the transitional /
  // desktop-proven path). U6: when omitted, the system-prompt extension composes
  // the prompt via its `before_agent_start` hook instead, so no override is
  // installed and the hook's returned prompt governs the turn.
  const agentDir = await preparePiAgentDirectory(inputs.cwd, inputs.agentDir);
  const systemPromptValue = inputs.systemPrompt;
  const resourceLoader = new DefaultResourceLoader({
    cwd: inputs.cwd,
    agentDir,
    ...(systemPromptValue !== undefined
      ? { systemPromptOverride: () => systemPromptValue }
      : {}),
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
          sessionDir: inputs.sessionDir ?? path.join(agentDir, "sessions"),
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
    agentDir,
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
    readSessionEntries: () =>
      typeof (sessionManager as { getBranch?: () => unknown[] }).getBranch ===
      "function"
        ? (sessionManager as { getBranch: () => unknown[] }).getBranch()
        : sessionManager.getEntries(),
  };
}

export async function preparePiAgentDirectory(
  cwd: string,
  agentDir = path.join(cwd, PI_AGENT_DIR),
): Promise<string> {
  const symlinkTarget = await workspaceSymlinkTarget(cwd);
  if (symlinkTarget) {
    await mkdir(symlinkTarget, { recursive: true });
  }

  await mkdir(cwd, { recursive: true });
  const resolvedAgentDir = path.isAbsolute(agentDir)
    ? agentDir
    : path.resolve(cwd, agentDir);
  await mkdir(resolvedAgentDir, { recursive: true });
  return resolvedAgentDir;
}

async function workspaceSymlinkTarget(cwd: string): Promise<string | null> {
  try {
    const stat = await lstat(cwd);
    if (!stat.isSymbolicLink()) return null;
    const target = await readlink(cwd);
    return path.isAbsolute(target)
      ? target
      : path.resolve(path.dirname(cwd), target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function runAgentLoop(
  args: RunAgentLoopArgs,
  deps: RunAgentLoopDeps = {},
): Promise<RunAgentLoopResult> {
  const openSession = deps.openSession ?? defaultOpenSession;

  const toolsCalled = new Set<string>();
  const toolInvocations: RunAgentLoopResult["toolInvocations"] = [];
  let uiMessageParts: NonNullable<RunAgentLoopResult["uiMessageParts"]> = [];
  const toolStarts = new Map<string, number>();
  const identity = isInvocationIdentity(args.identity) ? args.identity : null;
  // ask_user_question turn-end (U5): set when a non-error tool result carries
  // the persisted-question sentinel. The turn must end as a SUCCESS — the
  // asking turn's finalize runs normally and the thread parks AWAITING_USER.
  let askEndTurnSeen = false;

  const customTools = args.tools.map(toToolDefinition);
  const toolAllowlist = buildToolAllowlist(
    customTools,
    args.extensionToolNames,
    args.builtinToolNames,
  );
  const requestedModelId = resolveModelIdString(args.modelId);
  const cwd = args.cwd?.trim() || process.cwd();

  const { session, modelId, durable, persistSession, readSessionEntries } =
    await openSession({
      cwd,
      agentDir: args.agentDir?.trim() || undefined,
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
        toolStarts.set(event.toolCallId, Date.now());
        toolsCalled.add(event.toolName);
        deps.log?.({
          level: "info",
          event: "agentcore_phase",
          name: "thinkwork.agentcore.phase",
          scope: { name: "thinkwork.pi.runtime" },
          spanId: phaseSpanId("runtime.tool_execution", event.toolCallId),
          sessionId: args.threadId,
          source: "agentcore-pi",
          phase: "runtime.tool_execution",
          status: "started",
          tenantId: identity?.tenantId,
          userId: identity?.userId,
          agentId: identity?.agentId,
          threadId: args.threadId,
          traceId: identity?.traceId,
          runtimeType: "pi",
          detail: event.toolName,
        });
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
        // Live emit — shape matches the client dedup contract (it dedups live
        // events against usage.tool_invocations by tool_name). Guarded so a
        // throwing emitter can never break the turn.
        emitActivitySafely(deps, {
          eventType: "tool_invocation_started",
          message: event.toolName,
          stream: "step",
          payload: {
            id: event.toolCallId,
            tool_name: event.toolName,
            input_preview: toolPreview(event.args),
            status: "running",
          },
        });
        return;
      }
      if (event.type === "tool_execution_end") {
        const finished = new Date().toISOString();
        const started = toolStarts.get(event.toolCallId);
        const modelRouting = extractModelRoutingRecord({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
        });
        const agentProfileRun = findAgentProfileRunRecord(event.result);
        const okfWikiTrace = okfWikiContextTraceFromToolResult(event.result, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        });
        deps.log?.({
          level: event.isError ? "error" : "info",
          event: "agentcore_phase",
          name: "thinkwork.agentcore.phase",
          scope: { name: "thinkwork.pi.runtime" },
          spanId: phaseSpanId("runtime.tool_execution", event.toolCallId),
          sessionId: args.threadId,
          source: "agentcore-pi",
          phase: "runtime.tool_execution",
          status: event.isError ? "failed" : "completed",
          tenantId: identity?.tenantId,
          userId: identity?.userId,
          agentId: identity?.agentId,
          threadId: args.threadId,
          traceId: identity?.traceId,
          runtimeType: "pi",
          durationMs: started ? Date.now() - started : undefined,
          detail: event.toolName,
        });
        const existing = toolInvocations.find(
          (item) => item.id === event.toolCallId,
        );
        if (existing) {
          existing.result = event.result;
          existing.is_error = event.isError;
          existing.output_preview = toolPreview(event.result);
          existing.status = event.isError ? "error" : "ok";
          existing.finished_at = finished;
          if (modelRouting) existing.model_routing = modelRouting;
          if (agentProfileRun) existing.agent_profile_run = agentProfileRun;
          if (okfWikiTrace) existing.okf_wiki_trace = okfWikiTrace;
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
            ...(modelRouting ? { model_routing: modelRouting } : {}),
            ...(agentProfileRun ? { agent_profile_run: agentProfileRun } : {}),
            ...(okfWikiTrace ? { okf_wiki_trace: okfWikiTrace } : {}),
            finished_at: finished,
            runtime: "pi",
          });
        }
        emitActivitySafely(deps, {
          eventType: "tool_invocation_completed",
          message: event.toolName,
          stream: "step",
          level: event.isError ? "error" : undefined,
          payload: {
            id: event.toolCallId,
            tool_name: event.toolName,
            output_preview: toolPreview(event.result),
            status: event.isError ? "error" : "ok",
            is_error: event.isError,
          },
        });
        if (okfWikiTrace) {
          emitActivitySafely(deps, {
            eventType: OKF_WIKI_CONTEXT_TRACE_EVENT_TYPE,
            message: okfWikiContextTraceMessage(okfWikiTrace),
            stream: "step",
            color: okfWikiTrace.truncated ? "amber" : "blue",
            payload: okfWikiTrace,
          });
        }
        const genuiParts = extractRuntimeThreadGenUICandidates(
          event.result,
        ).map(
          (candidate, index) =>
            normalizeRuntimeThreadGenUIPart(
              candidate,
              `genui:${event.toolCallId}:${index}`,
            ).part,
        );
        if (genuiParts.length > 0) {
          uiMessageParts = mergeFinalThreadGenUIParts(
            uiMessageParts,
            genuiParts,
          );
          for (const part of genuiParts) {
            emitActivitySafely(deps, threadGenUIActivityEvent(part));
          }
        }
        // ask_user_question turn-end (U5): the tool result is recorded above;
        // now stop the run deterministically. The sentinel result itself
        // carries the SDK's `terminate: true` early-termination hint, which
        // cleanly ends a single-call batch; `session.abort()` is the backstop
        // for a mixed parallel batch where the hint isn't unanimous (the
        // abort signal is checked after each recorded result, so this result
        // survives). The success path below treats the sentinel as
        // authoritative so an abort-shaped trailing stub can't fail the turn.
        if (
          !event.isError &&
          event.toolName === ASK_USER_QUESTION_TOOL_NAME &&
          askUserQuestionEndTurn(event.result)
        ) {
          askEndTurnSeen = true;
          deps.log?.({
            level: "info",
            event: "ask_user_question_turn_end",
            threadId: args.threadId,
            toolCallId: event.toolCallId,
          });
          if (session.abort) {
            void session.abort().catch(() => {});
          }
        }
      }
    });

    // A durable session carries prior context (resumed or seeded), so send only
    // the new message. Without one, fall back to prepending conversation text.
    const previousPwd = process.env.PWD;
    process.env.PWD = cwd;
    try {
      await session.prompt(durable ? args.message : buildTurnPrompt(args));
    } finally {
      if (previousPwd === undefined) {
        delete process.env.PWD;
      } else {
        process.env.PWD = previousPwd;
      }
    }

    // After an ask_user_question turn-end the backstop abort can leave a
    // trailing assistant stub with stopReason "aborted" (or, in pathological
    // stream teardown, "error") AFTER the real tool-call message. The
    // question persisted, so the turn is a SUCCESS by contract: skip those
    // stubs when extracting content and don't let them fail the turn.
    const assistant = [...session.messages]
      .reverse()
      .find((message): message is AssistantMessage => {
        if (message.role !== "assistant") return false;
        if (!askEndTurnSeen) return true;
        const stopReason = (message as { stopReason?: unknown }).stopReason;
        return stopReason !== "aborted" && stopReason !== "error";
      });
    const assistantFailure = askEndTurnSeen
      ? undefined
      : assistantFailureMessage(assistant);
    if (assistantFailure) {
      throw new Error(assistantFailure);
    }

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

    const modelRoutedToolCalls = toolInvocations.flatMap((invocation) =>
      invocation.model_routing ? [invocation.model_routing] : [],
    );
    const agentProfileRuns = toolInvocations.flatMap((invocation) =>
      invocation.agent_profile_run ? [invocation.agent_profile_run] : [],
    );
    const goalRun = args.goalRunExtractor?.({
      sessionEntries: readSessionEntries?.() ?? [],
      toolInvocations,
    });

    return {
      content: textFromAssistant(assistant),
      usage: assistant?.usage,
      modelId,
      toolsCalled: [...toolsCalled],
      toolInvocations,
      ...(uiMessageParts.length > 0 ? { uiMessageParts } : {}),
      ...(modelRoutedToolCalls.length > 0 ? { modelRoutedToolCalls } : {}),
      ...(agentProfileRuns.length > 0 ? { agentProfileRuns } : {}),
      ...(goalRun ? { goalRun } : {}),
      toolCosts: toolInvocations.flatMap((invocation) =>
        collectToolCosts(invocation.result),
      ),
    };
  } finally {
    session.dispose();
  }
}

function isInvocationIdentity(value: unknown): value is PiInvocationIdentity {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.tenantId === "string" &&
    typeof record.agentId === "string" &&
    typeof record.threadId === "string"
  );
}

function phaseSpanId(phase: string, id: string): string {
  const safe = `${phase}-${id}`
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `tw-${safe || "agentcore-phase"}`;
}

// Re-export so consumers (and the inert U2 package later) can reference the
// concrete session type without re-importing the SDK.
export type { AgentSession };
