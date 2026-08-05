/**
 * Chat Agent Invoke Lambda — SETUP phase only.
 *
 * After the direct-callback finalize refactor (plan 2026-05-22-006), this
 * Lambda does:
 *
 *   1. Looks up the agent + resolves runtime config (skills, MCP, KBs,
 *      sandbox preflight, guardrail, workspace tuple).
 *   2. Builds the AgentCore invoke payload with finalize-callback fields
 *      (URL + bearer secret + thread_turn_id).
 *   3. Dispatches the AgentCore adapter Lambda in Event mode (no wait).
 *   4. Returns in ~5 seconds end-to-end.
 *
 * The AgentCore runtime POSTs its end-of-turn result to
 * /api/threads/{threadId}/finalize. The chat-agent-finalize Lambda runs
 * the post-AgentCore bookkeeping (cost, guardrail-block, message insert,
 * AppSync notify, computer-task completion, memory retain) out-of-band.
 * This decouples Lambda lifetime from agent-turn duration, so 8h-capable
 * AgentCore runs no longer hit the 5-min Lambda timeout / auto-retry
 * cascade.
 */

import {
  deriveFunctionName,
  getConfig,
  getApiAuthSecret,
} from "@thinkwork/runtime-config";
import { eq, and, ne, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  agentWakeupRequests,
  messages,
  spaces,
  threads,
  users,
  threadTurns,
} from "@thinkwork/database-pg/schema";
import { randomBytes, randomUUID } from "crypto";
import {
  claimThreadCheckout,
  releaseThreadCheckout,
} from "../lib/thread-checkout.js";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import {
  applySandboxPayloadFields,
  checkSandboxPreflight,
  type SandboxPreflightResult,
} from "../lib/sandbox-preflight.js";
import {
  AgentNotFoundError,
  resolveAgentRuntimeConfig,
  tenantCatalogSkillS3Key,
} from "../lib/resolve-agent-runtime-config.js";
import {
  EMIT_JSON_RENDER_UI_TOOL_NAME,
  THREAD_JSON_RENDER_UI_CAPABILITY,
} from "../lib/thread-json-render/capability.js";
import { buildPinnedSkillConfigs } from "../lib/skills/message-pinned-skills.js";
import { documentPlatesForDispatch } from "../lib/artifacts/plate-registry.js";
import {
  resolveChatDispatchTarget,
  resolveRuntimeFunctionName,
  UnknownAgentRuntimeTypeError,
  type AgentRuntimeType,
} from "../lib/resolve-runtime-function-name.js";
import {
  isToolAllowed,
  type EffectiveWorkspacePolicy,
} from "../lib/workspace-renderer/index.js";
import { isBuiltinToolSlug } from "../lib/builtin-tool-slugs.js";
import { toolPolicyAliases } from "../lib/builtin-tool-policy-aliases.js";
import { loadTrustedCatalogSkillIds } from "../lib/skill-trust/runtime-gate.js";
// Post-AgentCore helpers — previously inline in this file; lifted into
// the shared chat-finalize lib so chat-agent-finalize (the new HTTP
// handler) and chat-agent-invoke (this file, for pre-dispatch error
// paths only) share a single source of truth.
import {
  GENERIC_AGENT_ERROR_MESSAGE,
  insertAssistantMessage,
  markComputerTaskFailedFromFinalize,
  notifyNewMessage,
  notifyThreadTurnUpdate,
} from "../lib/chat-finalize/notify.js";
import { logAgentCorePhase } from "../lib/agentcore-phase-log.js";
import { checkUserBudgetAndPauseWork } from "../lib/user-budget-enforcement.js";
import { normalizeRequestedModelId } from "../lib/turn-model-selection.js";
import {
  assertUserModelApproved,
  listApprovedModelCatalog,
  ModelApprovalError,
} from "../lib/model-approvals.js";
import {
  toRuntimePendingUserQuestions,
  type PendingQuestionAnswersPayload,
} from "../lib/user-questions/runtime-payload.js";
import type { RuntimeSkillCreatorCommandPayload } from "../lib/skill-creator/command-metadata.js";
import { buildAgentDispatchControlFields } from "../lib/agent-dispatch-payload.js";
import { mintTurnAssertion } from "../lib/turn-assertion.js";
import { memberSpacesForDispatch } from "../lib/member-spaces.js";
import { buildMcpConfigs } from "../lib/mcp-configs.js";
import {
  fingerprintInputsFromCapabilitiesManifest,
  parseCapabilitiesManifest,
  type CapabilitiesManifest,
} from "../lib/capabilities/manifest-compile.js";
import {
  computeConfigFingerprint,
  fingerprintInputsFromRuntimeConfig,
} from "../lib/capability-fingerprint.js";
import {
  isWorkspaceProjectionManifestLike,
  recordDispatchWorkspaceProjectionSnapshot,
  type WorkspaceProjectionManifestLike,
} from "../lib/workspace-projection-snapshot.js";
import {
  computeRoutingSignature,
  evaluateRenderSkip,
  probeSourcePrefixesUnchanged,
  readThreadLastRender,
  writeThreadLastRender,
  THREAD_LAST_RENDER_VERSION,
  type ThreadLastRenderMarker,
} from "../lib/workspace-render-skip.js";

/**
 * Extract or generate a trace ID for correlating CloudWatch/X-Ray traces.
 * Prefers the Lambda X-Ray trace ID if active, otherwise generates a
 * W3C-compatible 32-hex-char trace ID.
 */
function getTraceId(): string {
  const xrayTraceId = process.env._X_AMZN_TRACE_ID;
  if (xrayTraceId) {
    // Format: Root=1-xxxx-yyyyyyyy;Parent=zzzz;Sampled=1
    const rootMatch = xrayTraceId.match(/Root=([^;]+)/);
    if (rootMatch) return rootMatch[1];
  }
  // Fallback: generate W3C-compatible trace ID (32 hex chars)
  return randomBytes(16).toString("hex");
}

// Config-class values are read at call time via getConfig (env-wins merge
// over the SSM document) — never captured at module load (R3): the SSM
// document may load after module init, and vitest stubs env after import.
// Secret-class values are read at call time via getApiAuthSecret, never
// captured at module load.
function workspaceBucket(): string {
  return getConfig("WORKSPACE_BUCKET", "");
}
// API URL used by skills for callbacks (thread-management, email-send, etc.)
// Reads THINKWORK_API_URL first, falls back to legacy MCP_BASE_URL until infra is updated.
function thinkworkApiUrl(): string {
  return getConfig("THINKWORK_API_URL") || process.env.MCP_BASE_URL || "";
}
// Company Brain twin tool seam (plan 2026-07-21-001 U7) — same rollout
// posture: stage env flag, per-agent tool policy can still block.
// THINK-321 U5 — stage-level seam flag for the agent-facing identity
// resolution tools (resolve_entities / propose_mapping_candidates /
// confirm_mapping). Stage rollout pattern: terraform
// sets IDENTITY_RESOLUTION_ENABLED on this Lambda; per-agent tool policy
// gates on top.
const IDENTITY_RESOLUTION_TOOL_ENABLED =
  (process.env.IDENTITY_RESOLUTION_ENABLED || "").toLowerCase() === "true";
function workspaceRendererFunctionName(): string {
  // Derived from the per-stage naming convention (R7); a config/env
  // override still wins. "" preserves the legacy unconfigured guard
  // path for non-Lambda contexts without STAGE (vitest).
  // Alias-qualified (THINK-583 U3): provisioned concurrency only serves
  // invokes addressed to the `live` alias — an unqualified invoke hits
  // $LATEST and silently bypasses the warm pool.
  const explicit = getConfig("WORKSPACE_RENDERER_FUNCTION_NAME");
  if (explicit) return explicit;
  return process.env.STAGE
    ? `${deriveFunctionName("workspace-renderer")}:live`
    : "";
}
// Used by sandbox-preflight to namespace Secrets Manager paths per stage.
// STACK_NAME is the legacy env var every other handler reads; mirror that.
const STAGE = process.env.STAGE || process.env.STACK_NAME || "dev";

const db = getDb();
const lambdaClient = new LambdaClient({});

type RuntimeMcpConfig = {
  name?: string;
  serverName?: string;
  url?: string;
};

const EXPLICIT_PLUGIN_MCP_ALIASES: Record<string, string[]> = {
  n8n: ["n8n", "workflow automation"],
  twenty: ["twenty", "twenty crm"],
};

function configPluginKey(config: RuntimeMcpConfig): string | null {
  const name = String(config.name ?? config.serverName ?? "").toLowerCase();
  const match = /^([a-z0-9-]+)--/.exec(name);
  return match?.[1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(alias: string): string {
  return escapeRegExp(alias.trim()).replace(/\s+/g, "\\s+");
}

function hasAliasMention(message: string, alias: string): boolean {
  return new RegExp(`\\b${aliasPattern(alias)}\\b`).test(message);
}

function hasNegatedAliasMention(message: string, alias: string): boolean {
  const pattern = aliasPattern(alias);
  const optionalArticle = "(?:the\\s+)?";
  return [
    new RegExp(
      `\\b(?:do\\s+not|don't|dont|never)\\s+(?:use|call|invoke|query|select|choose|route\\s+to)\\s+${optionalArticle}${pattern}\\b`,
    ),
    new RegExp(
      `\\bnot\\s+(?:use|using|call|calling|invoke|invoking|querying)\\s+${optionalArticle}${pattern}\\b`,
    ),
    new RegExp(
      `\\bwithout\\s+(?:using\\s+|calling\\s+|invoking\\s+|querying\\s+)?${optionalArticle}${pattern}\\b`,
    ),
    new RegExp(`\\bno\\s+${pattern}\\b`),
  ].some((negated) => negated.test(message));
}

function mentionedPluginIntent(
  message: string,
  configs: RuntimeMcpConfig[],
): { requested: Set<string>; excluded: Set<string> } {
  const lower = message.toLowerCase();
  const configuredKeys = new Set(
    configs.map(configPluginKey).filter((key): key is string => Boolean(key)),
  );
  const requested = new Set<string>();
  const excluded = new Set<string>();
  for (const key of configuredKeys) {
    const aliases = EXPLICIT_PLUGIN_MCP_ALIASES[key] ?? [key];
    const negated = aliases.some(
      (alias) =>
        hasAliasMention(lower, alias) && hasNegatedAliasMention(lower, alias),
    );
    if (negated) {
      excluded.add(key);
    }
    const positive = aliases.some(
      (alias) =>
        hasAliasMention(lower, alias) && !hasNegatedAliasMention(lower, alias),
    );
    if (positive) {
      requested.add(key);
    }
  }
  return { requested, excluded };
}

function filterMcpConfigsForExplicitPluginMention<T extends RuntimeMcpConfig>(
  configs: T[],
  message: string,
): T[] {
  const { requested, excluded } = mentionedPluginIntent(message, configs);
  if (requested.size === 0 && excluded.size === 0) return configs;

  const narrowed = configs.filter((config) => {
    const key = configPluginKey(config);
    if (!key) return true;
    if (excluded.has(key)) return false;
    if (requested.size > 0) return requested.has(key);
    return true;
  });
  return narrowed.length > 0 ? narrowed : configs;
}

// GENERIC_AGENT_ERROR_MESSAGE + extractResponseText now live in
// packages/api/src/lib/chat-finalize/notify.ts. The import at the top of
// this file pulls GENERIC_AGENT_ERROR_MESSAGE for the pre-dispatch error
// paths; extractResponseText is only used by the finalize handler.

interface InvokeAttachment {
  attachmentId: string;
  s3Key: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

interface InvokeEvent {
  threadId: string;
  tenantId: string;
  agentId: string;
  userMessage: string;
  messageId?: string;
  computerId?: string;
  computerTaskId?: string;
  desktopDelegation?: {
    parentThreadTurnId: string;
    requestedVisibility: "hidden" | "visible";
    effectiveVisibility: "hidden" | "visible";
    reason?: string;
  };
  /**
   * U3 of the finance pilot — the dispatch caller (thread-cutover.ts)
   * resolves `messages.metadata.attachments` against `thread_attachments`
   * with a tenant pin and passes the full record set here. Empty when
   * the turn has no attachments. Forwarded to the AgentCore Lambda
   * invoke payload as `message_attachments` (snake_case for Python).
   */
  messageAttachments?: InvokeAttachment[];
  /**
   * Force-pinned skill slugs the composer slash-command attached to this
   * message (plan 2026-06-04-004). Raw slugs resolved from
   * `messages.metadata.skills` by the dispatch caller. Filtered through the
   * same tool policy as installed skills, then forwarded to AgentCore as the
   * ephemeral `pinned_skills` branch (skillId + catalog s3Key) so the runtime
   * can load + emphasize them for this turn without a permanent install.
   */
  pinnedSkills?: string[];
  /**
   * Reply-consumed ask_user_question answer context (plan 2026-06-09-005
   * U3). The dispatch caller (sendMessage → default-agent-routing)
   * CAS-consumed the pending batch and attaches the answer context to the
   * turn it already fires. Forwarded to the runtime as the snake_case
   * `pending_user_questions` payload field (like message_attachments).
   * The turn keeps invocation_source 'chat_message' on this path; the
   * wakeup-resume path (wakeup-processor, source 'question_answer') sets
   * invocation_source 'question_answer' from the wakeup row.
   */
  pendingQuestionAnswers?: PendingQuestionAnswersPayload;
  skillCreatorCommand?: RuntimeSkillCreatorCommandPayload;
  /**
   * THINK-263 U6: this turn opens a palette "ask". The invoke payload sends
   * `use_memory: false` so the ephemeral answer is cost-metered but never
   * retained to memory (the retain runtime honors only `use_memory === true`).
   */
  askMode?: boolean;
  modelId?: string;
  requestedModelId?: string;
  /**
   * THINK-311 U5b: per-turn Harness trial selection (composer runtime
   * picker → messages.metadata.requestedRuntime → dispatch). Honored only
   * when the stage-level HARNESS_TRIAL_ENABLED gate is on; requested with
   * the gate off is an explicit visible failure, never a silent Pi run.
   */
  requestedRuntime?: string;
  requestedProfileSlug?: string;
  /**
   * Mobile Pi background handoff reuses the durable local thread_turn row so
   * AgentCore finalizes the same logical turn instead of creating a second one.
   */
  existingThreadTurnId?: string;
  mobileHandoff?: {
    checkpointSeq: number;
    latestObservedCheckpointSeq?: number;
    unsafeCheckpointSkipped?: boolean;
  };
}

export interface RenderWorkspaceTupleForInvokeInput {
  tenantId: string;
  agentId: string;
  spaceId: string;
  threadId?: string | null;
  threadSlug?: string | null;
  userId?: string | null;
  agentBlockedTools?: unknown;
  agentAllowedTools?: unknown;
}

export interface RenderWorkspaceTupleForInvokeResult {
  rendered: boolean;
  renderedPrefix?: string;
  /** "skip" = renderer invoke skipped, values carried from the thread's last render (U2, plan 2026-08-03-001). */
  cacheStatus?: "hit" | "miss" | "skip";
  /** Source prefixes the renderer listed — persisted for the render-skip freshness probe. */
  sourcePrefixes?: string[];
  activeSpace?: {
    id: string;
    slug: string;
    name: string;
    isDefault: boolean;
  };
  effectivePolicy?: EffectiveWorkspacePolicy;
  /**
   * Hydrate manifest from the renderer Lambda — feeds the per-turn
   * workspace projection snapshot (plan 2026-06-12-002 U6).
   */
  hydrateManifest?: WorkspaceProjectionManifestLike;
  /** Compiled capabilities manifest identity + body (THINK-173 U5). */
  capabilities?: {
    fingerprint: string;
    manifest: CapabilitiesManifest | null;
  };
  errorCode?: string;
  statusCode?: number;
  reason?: string;
}

interface RenderWorkspaceTupleForInvokeDeps {
  lambda?: Pick<LambdaClient, "send">;
  functionName?: string;
}

const RENDERER_INVOKE_RETRY_DELAY_MS = Number(
  process.env.RENDERER_INVOKE_RETRY_DELAY_MS ?? "250",
);

function isTransientLambdaInvokeError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (
    name === "ServiceException" ||
    name === "TooManyRequestsException" ||
    name === "EC2ThrottledException" ||
    name === "ResourceNotReadyException" ||
    name === "TimeoutError"
  ) {
    return true;
  }
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return typeof status === "number" && status >= 500;
}

export async function renderWorkspaceTupleForInvoke(
  input: RenderWorkspaceTupleForInvokeInput,
  deps: RenderWorkspaceTupleForInvokeDeps = {},
): Promise<RenderWorkspaceTupleForInvokeResult> {
  const functionName =
    deps.functionName ?? workspaceRendererFunctionName() ?? "";
  if (!functionName) {
    return { rendered: false, reason: "workspace_renderer_unconfigured" };
  }

  const client = deps.lambda ?? lambdaClient;
  const invoke = () =>
    client.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(
          JSON.stringify({
            tenantId: input.tenantId,
            agentId: input.agentId,
            spaceId: input.spaceId,
            threadId: input.threadId ?? null,
            threadSlug: input.threadSlug ?? input.threadId ?? null,
            userId: input.userId ?? null,
            agentBlockedTools: input.agentBlockedTools,
            agentAllowedTools: input.agentAllowedTools,
          }),
        ),
      }),
    );
  let response: Awaited<ReturnType<typeof invoke>>;
  try {
    response = await invoke();
  } catch (err) {
    // One retry on AWS-side transport failures (Lambda 5xx / throttle):
    // a single blip here otherwise fails the whole turn via the R9 manifest
    // guard (observed live 2026-08-04, ServiceException on a healthy fn).
    // Caller-side errors (AccessDenied, ResourceNotFound) rethrow untouched.
    if (!isTransientLambdaInvokeError(err)) throw err;
    await new Promise((resolve) =>
      setTimeout(resolve, RENDERER_INVOKE_RETRY_DELAY_MS),
    );
    response = await invoke();
  }

  const rawPayload = response.Payload
    ? new TextDecoder().decode(response.Payload)
    : "{}";
  if (response.FunctionError) {
    return {
      rendered: false,
      reason: `workspace_renderer_function_error:${response.FunctionError}`,
    };
  }

  const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
  if (parsed.ok !== true || typeof parsed.renderedPrefix !== "string") {
    const errorPayload =
      typeof parsed.error === "object" && parsed.error
        ? (parsed.error as Record<string, unknown>)
        : null;
    return {
      rendered: false,
      errorCode:
        typeof errorPayload?.code === "string" ? errorPayload.code : undefined,
      statusCode:
        typeof parsed.statusCode === "number" ? parsed.statusCode : undefined,
      reason: errorPayload
        ? JSON.stringify(errorPayload)
        : "workspace_renderer_failed",
    };
  }

  return {
    rendered: true,
    renderedPrefix: parsed.renderedPrefix,
    activeSpace: isActiveSpacePayload(parsed.activeSpace)
      ? parsed.activeSpace
      : undefined,
    capabilities: parseRenderedCapabilitiesPayload(parsed.capabilities),
    effectivePolicy: isEffectiveWorkspacePolicy(parsed.effectivePolicy)
      ? parsed.effectivePolicy
      : undefined,
    hydrateManifest: isWorkspaceProjectionManifestLike(parsed.hydrateManifest)
      ? parsed.hydrateManifest
      : undefined,
    cacheStatus:
      parsed.cacheStatus === "hit" || parsed.cacheStatus === "miss"
        ? parsed.cacheStatus
        : undefined,
    sourcePrefixes: isStringArray(parsed.sourcePrefixes)
      ? parsed.sourcePrefixes
      : undefined,
  };
}

/**
 * Rebuild a render result from the thread's persisted last-render marker
 * (render-skip, U2 of plan 2026-08-03-001). Every carried value re-validates
 * through the same parsers the live renderer response goes through, so a
 * corrupt marker degrades to `rendered: false` and the caller falls back to
 * a full render — never a stale/empty prefix.
 */
export function renderResultFromLastRenderMarker(
  marker: ThreadLastRenderMarker,
): RenderWorkspaceTupleForInvokeResult | null {
  if (!marker.renderedPrefix) return null;
  const capabilities =
    marker.capabilities && typeof marker.capabilities.fingerprint === "string"
      ? {
          fingerprint: marker.capabilities.fingerprint,
          manifest: parseCapabilitiesManifest(
            marker.capabilities.manifest === undefined ||
              marker.capabilities.manifest === null
              ? null
              : JSON.stringify(marker.capabilities.manifest),
          ),
        }
      : undefined;
  return {
    rendered: true,
    renderedPrefix: marker.renderedPrefix,
    cacheStatus: "skip",
    sourcePrefixes: marker.sourcePrefixes,
    activeSpace: isActiveSpacePayload(marker.activeSpace)
      ? marker.activeSpace
      : undefined,
    capabilities,
    effectivePolicy: isEffectiveWorkspacePolicy(marker.effectivePolicy)
      ? marker.effectivePolicy
      : undefined,
    hydrateManifest: isWorkspaceProjectionManifestLike(marker.hydrateManifest)
      ? marker.hydrateManifest
      : undefined,
  };
}

/**
 * Validate the renderer Lambda's capabilities payload (THINK-173 U5).
 * The manifest body re-validates through the same parser the renderer
 * used, so a malformed cross-Lambda payload degrades to `manifest: null`
 * — which the folder dispatch path treats as a loud failure for flag-on
 * agents rather than a silent legacy fallback.
 */
function parseRenderedCapabilitiesPayload(
  value: unknown,
): RenderWorkspaceTupleForInvokeResult["capabilities"] {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.fingerprint !== "string") return undefined;
  return {
    fingerprint: record.fingerprint,
    manifest: parseCapabilitiesManifest(
      record.manifest === undefined ? null : JSON.stringify(record.manifest),
    ),
  };
}

function isActiveSpacePayload(value: unknown): value is {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
} {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.slug === "string" &&
    typeof obj.name === "string" &&
    typeof obj.isDefault === "boolean"
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isNullableStringArray(value: unknown): value is string[] | null {
  return value === null || isStringArray(value);
}

function isEffectiveWorkspacePolicy(
  value: unknown,
): value is EffectiveWorkspacePolicy {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    isStringArray(obj.blockedTools) &&
    isNullableStringArray(obj.allowedTools) &&
    isNullableStringArray(obj.mcpAllowedServers) &&
    isStringArray(obj.mcpBlockedServers) &&
    isStringArray(obj.diagnostics)
  );
}

type ChatInvokeIdentitySource =
  | "message_sender"
  | "thread_creator"
  | "computer_agent_human_pair"
  | "none";

export interface ChatInvokeIdentity {
  currentUserId: string;
  currentUserEmail: string;
  source: ChatInvokeIdentitySource;
}

interface MessageSenderRow {
  sender_id: string | null;
  sender_type: string | null;
}

interface ThreadCreatorRow {
  created_by_id: string | null;
  created_by_type: string | null;
}

export interface ChatInvokeIdentityDeps {
  loadMessageSender(messageId: string): Promise<MessageSenderRow | null>;
  loadThreadCreator(threadId: string): Promise<ThreadCreatorRow | null>;
  loadAgentHumanPair(args: {
    agentId: string;
    tenantId: string;
  }): Promise<string | null>;
  loadUserEmail(userId: string): Promise<string>;
}

export function createDrizzleChatInvokeIdentityDeps(
  dbClient = db,
): ChatInvokeIdentityDeps {
  return {
    async loadMessageSender(messageId) {
      const [msg] = await dbClient
        .select({
          sender_id: messages.sender_id,
          sender_type: messages.sender_type,
        })
        .from(messages)
        .where(eq(messages.id, messageId));
      return msg ?? null;
    },
    async loadThreadCreator(threadId) {
      const [thread] = await dbClient
        .select({
          created_by_id: threads.created_by_id,
          created_by_type: threads.created_by_type,
        })
        .from(threads)
        .where(eq(threads.id, threadId));
      return thread ?? null;
    },
    async loadAgentHumanPair({ agentId, tenantId }) {
      const [agent] = await dbClient
        .select({ human_pair_id: agents.human_pair_id })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)));
      return agent?.human_pair_id ?? null;
    },
    async loadUserEmail(userId) {
      const [u] = await dbClient
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId));
      return u?.email || "";
    },
  };
}

/**
 * THINK-263 U6 — decide the invoke payload's `use_memory` value. A palette
 * "ask" turn (`askMode`) suppresses retention (false); every other turn opts
 * in (true). The retain runtime honors ONLY `true`, so this is the whole
 * contract — no retain-handler change is needed to keep ask answers ephemeral.
 */
export function resolveTurnUseMemory(askMode?: boolean | null): boolean {
  return askMode ? false : true;
}

/**
 * THINK-311 U5b: per-turn runtime selection. The composer's runtime
 * picker is the control — an "agentcore" request routes this turn to the
 * AgentCore Harness runner. On a stage without the Harness infra the run
 * fails loudly downstream; it never silently falls back to Pi (R4).
 */
export function resolveChatInvocationRuntimeType(args: {
  configuredRuntimeType: AgentRuntimeType;
  requestedRuntime?: string | null;
  computerId?: string | null;
  computerTaskId?: string | null;
}): AgentRuntimeType {
  const requested = (args.requestedRuntime ?? "").toLowerCase();
  if (requested === "agentcore" || requested === "harness") {
    // THINK-324: the managed harness is retired — legacy pins and stale
    // clients run Pi. Loud enough for CloudWatch, invisible to the user.
    console.warn(
      "[chat-agent-invoke] Legacy harness runtime request resolved to Pi (harness retired)",
    );
    return "pi";
  }
  if (requested && requested !== "pi") {
    // Mistyped runtime request → loud failure, never a silent wrong run.
    throw new UnknownAgentRuntimeTypeError(requested);
  }
  return "pi";
}

export async function resolveChatInvokeIdentity(
  args: {
    threadId: string;
    tenantId: string;
    agentId: string;
    messageId?: string;
  },
  deps: ChatInvokeIdentityDeps = createDrizzleChatInvokeIdentityDeps(),
): Promise<ChatInvokeIdentity> {
  if (args.messageId) {
    const msg = await deps.loadMessageSender(args.messageId);
    if (
      (msg?.sender_type === "human" || msg?.sender_type === "user") &&
      msg.sender_id
    ) {
      return {
        currentUserId: msg.sender_id,
        currentUserEmail: await deps.loadUserEmail(msg.sender_id),
        source: "message_sender",
      };
    }
  }

  const thread = await deps.loadThreadCreator(args.threadId);
  if (thread?.created_by_type === "user" && thread.created_by_id) {
    return {
      currentUserId: thread.created_by_id,
      currentUserEmail: await deps.loadUserEmail(thread.created_by_id),
      source: "thread_creator",
    };
  }

  if (thread?.created_by_type === "computer") {
    const humanPairId = await deps.loadAgentHumanPair({
      agentId: args.agentId,
      tenantId: args.tenantId,
    });
    if (humanPairId) {
      return {
        currentUserId: humanPairId,
        currentUserEmail: await deps.loadUserEmail(humanPairId),
        source: "computer_agent_human_pair",
      };
    }
  }

  return {
    currentUserId: "",
    currentUserEmail: "",
    source: "none",
  };
}

async function markThreadTurnSetupFailed(input: {
  turnId: string;
  tenantId: string;
  threadId: string;
  agentId: string;
  message: string;
}) {
  try {
    await db
      .update(threadTurns)
      .set({
        status: "failed",
        finished_at: new Date(),
        last_activity_at: new Date(),
        error: input.message,
        error_code: "agentcore_setup_failed",
      })
      .where(
        and(
          eq(threadTurns.id, input.turnId),
          eq(threadTurns.tenant_id, input.tenantId),
          eq(threadTurns.status, "running"),
          sql`${threadTurns.finalized_at} IS NULL`,
        ),
      );
    await notifyThreadTurnUpdate({
      runId: input.turnId,
      tenantId: input.tenantId,
      threadId: input.threadId,
      agentId: input.agentId,
      status: "failed",
      triggerName: "AgentCore",
    });
  } catch (turnErr) {
    console.error(
      `[chat-agent-invoke] Failed to mark setup failure on thread_turn:`,
      turnErr,
    );
  }
  // THINK-324 C5 — a setup-failed turn never reaches finalize, so release
  // its thread checkout here (no-op when this turn doesn't hold it).
  await releaseThreadCheckout({
    threadId: input.threadId,
    runId: input.turnId,
  });
}

export async function handler(event: InvokeEvent): Promise<unknown | void> {
  // Snapshot secret-class values at handler entry — read at call time, never
  // at module load (vitest stubs env after import; the secret cache fills
  // during cold-start prime).
  const apiAuthSecret = getApiAuthSecret();
  const { threadId, tenantId, agentId, userMessage } = event;
  const existingThreadTurnId = event.existingThreadTurnId?.trim();
  const traceId = getTraceId();
  const setupStart = Date.now();
  console.log(
    `[chat-agent-invoke] threadId=${threadId} agentId=${agentId} traceId=${traceId}`,
  );
  logAgentCorePhase({
    source: "chat-agent-invoke",
    phase: "api.invoke.received",
    status: "started",
    traceId,
    tenantId,
    agentId,
    threadId,
    threadTurnId: existingThreadTurnId || undefined,
  });

  let turnId: string | undefined = existingThreadTurnId || undefined;
  try {
    const desktopDelegation = event.desktopDelegation;
    // U2 (plan 2026-08-03-001, R12): data-independent setup reads start
    // together. Document plates depend on tenantId alone; the helper
    // try/catches internally so this promise never rejects unhandled.
    const documentPlatesPromise = documentPlatesForDispatch(tenantId);
    // 1. Resolve per-invoker identity. This is the PER-TURN piece that the
    //    shared `resolveAgentRuntimeConfig` helper does NOT own — it's specific
    //    to the triggering chat event. Human/user messages and user-created
    //    threads keep their direct actor. Connector-created threads use the
    //    target agent's paired human as the trusted user context so Pi receives
    //    the required user_id without giving generic wakeups a fake invoker.
    const [identity, spaceContextResolved, priorMessageRows, lastRenderMarker] =
      await Promise.all([
        resolveChatInvokeIdentity({
          threadId,
          tenantId,
          agentId,
          messageId: event.messageId,
        }),
        resolveThreadSpaceContext({ tenantId, threadId }),
        loadPriorMessageRows({ threadId, messageId: event.messageId }),
        readThreadLastRender({ tenantId, threadId }),
      ]);
    const currentUserEmail = identity.currentUserEmail;
    const currentUserId = identity.currentUserId;
    if (identity.source !== "none") {
      console.log(
        `[chat-agent-invoke] resolved current user via ${identity.source}`,
      );
    }
    logAgentCorePhase({
      source: "chat-agent-invoke",
      phase: "api.identity.resolved",
      status: identity.source === "none" ? "skipped" : "completed",
      traceId,
      tenantId,
      agentId,
      threadId,
      detail: identity.source,
    });

    const spaceId = spaceContextResolved?.spaceId ?? null;
    const spaceSlug = spaceContextResolved?.spaceSlug ?? null;
    // Render-skip probe hoist (U2 follow-up): the S3 mtime probe and the DB
    // routing signature depend only on ids + the marker, so they start here
    // and overlap resolveAgentRuntimeConfig + turn creation instead of
    // sitting on the critical path at the render site (measured ~0.8–1.1 s
    // there). The fingerprint comparison still happens at the render site —
    // it needs runtimeConfig. Neither promise rejects (both fail closed).
    const routingSignaturePromise = spaceId
      ? computeRoutingSignature({
          tenantId,
          agentId,
          spaceId,
          userId: identity.currentUserId || null,
        })
      : null;
    const sourceProbePromise =
      spaceId && lastRenderMarker
        ? probeSourcePrefixesUnchanged({
            bucket: workspaceBucket() || "",
            sourcePrefixes: lastRenderMarker.sourcePrefixes,
            since: new Date(lastRenderMarker.generatedAt),
          })
        : null;
    // Member spaces need only identity — start now, await at the builder.
    // The helper try/catches internally (never rejects unhandled).
    const memberSpacesPromise = memberSpacesForDispatch(
      tenantId,
      identity.currentUserId,
    );

    // 2. Resolve agent runtime config (agent + template + tenant + skills +
    //    KBs + MCP + guardrail + sandbox template). Shared with the
    //    skill-run dispatcher's `/api/agents/runtime-config` endpoint.
    let runtimeConfig;
    try {
      runtimeConfig = await resolveAgentRuntimeConfig({
        tenantId,
        agentId,
        spaceId,
        currentUserId: currentUserId || undefined,
        currentUserEmail: currentUserEmail || undefined,
        // Email-only fallback to the agent's human pair (R15: only for
        // personalizing "you" in email copy — never used as currentUserId).
        allowHumanPairEmailFallback: true,
        logPrefix: "[chat-agent-invoke]",
        thinkworkApiUrl: thinkworkApiUrl(),
        thinkworkApiSecret: apiAuthSecret,
      });
    } catch (err) {
      if (err instanceof AgentNotFoundError) {
        console.error(`[chat-agent-invoke] ${err.message}`);
        if (turnId) {
          await markThreadTurnSetupFailed({
            turnId,
            tenantId,
            threadId,
            agentId,
            message: err.message,
          });
        }
        return;
      }
      throw err;
    }

    let runtimeType: AgentRuntimeType;
    try {
      runtimeType = resolveChatInvocationRuntimeType({
        configuredRuntimeType: runtimeConfig.runtimeType,
        requestedRuntime: event.requestedRuntime,
        computerId: event.computerId,
        computerTaskId: event.computerTaskId,
      });
    } catch (err) {
      if (err instanceof UnknownAgentRuntimeTypeError) {
        // Runtime was explicitly requested but cannot be honored: tell the
        // user in the thread instead of running any engine (R4). No turn
        // row exists yet, so an assistant message is the visible surface.
        console.warn(`[chat-agent-invoke] ${err.message}`);
        const errMsg = await insertAssistantMessage(
          threadId,
          tenantId,
          agentId,
          err.message,
        );
        if (errMsg) {
          await notifyNewMessage({
            messageId: errMsg.id,
            threadId,
            tenantId,
            role: "assistant",
            content: err.message,
            senderType: "agent",
            senderId: agentId,
          });
        }
        return { ok: false, threadTurnId: undefined };
      }
      throw err;
    }
    const configuredAgentModel = runtimeConfig.templateModel;
    const requestedParentModel =
      normalizeRequestedModelId(event.modelId) ??
      normalizeRequestedModelId(event.requestedModelId);
    if (requestedParentModel) {
      if (!currentUserId) {
        const message = "Requester user identity required for selected model.";
        console.warn(`[chat-agent-invoke] ${message}`);
        logAgentCorePhase({
          source: "chat-agent-invoke",
          phase: "api.model_approval",
          status: "failed",
          traceId,
          tenantId,
          agentId,
          threadId,
          runtimeType,
          detail: "missing_user",
        });
        if (turnId) {
          await markThreadTurnSetupFailed({
            turnId,
            tenantId,
            threadId,
            agentId,
            message,
          });
        }
        return { ok: false, threadTurnId: turnId };
      }
      try {
        await assertUserModelApproved({
          tenantId,
          userId: currentUserId,
          modelId: requestedParentModel,
        });
      } catch (err) {
        if (err instanceof ModelApprovalError) {
          console.warn(`[chat-agent-invoke] ${err.message}`);
          logAgentCorePhase({
            source: "chat-agent-invoke",
            phase: "api.model_approval",
            status: "failed",
            traceId,
            tenantId,
            agentId,
            threadId,
            runtimeType,
            detail: err.code,
          });
          if (turnId) {
            await markThreadTurnSetupFailed({
              turnId,
              tenantId,
              threadId,
              agentId,
              message: err.message,
            });
          }
          return { ok: false, threadTurnId: turnId };
        }
        throw err;
      }
    }
    const agentModel = requestedParentModel ?? configuredAgentModel;
    const tenantSlug = runtimeConfig.tenantSlug;
    const agentSlug = runtimeConfig.agentSlug;
    const humanName = runtimeConfig.humanName ?? "";
    const guardrailPayload = runtimeConfig.guardrailConfig;
    const skillsConfig = runtimeConfig.skillsConfig;
    const agent = {
      name: runtimeConfig.agentName,
      slug: runtimeConfig.agentSlug,
      human_pair_id: runtimeConfig.humanPairId,
    };
    logAgentCorePhase({
      source: "chat-agent-invoke",
      phase: "api.runtime_config.resolved",
      status: "completed",
      traceId,
      tenantId,
      agentId,
      threadId,
      runtimeType,
      count: skillsConfig.length,
      detail: `mcp=${runtimeConfig.mcpConfigs.length}`,
    });

    if (guardrailPayload) {
      console.log(
        `[chat-agent-invoke] Guardrail resolved: bedrock=${guardrailPayload.guardrailIdentifier}`,
      );
    }

    // PRD-38: Sub-agents are now skill-based (mode: agent in SKILL.md
    // frontmatter). The runtime reads mode/model from SKILL.md
    // frontmatter at /app/skills/{id}/SKILL.md (plan 2026-04-24-009 §U3
    // retired the parallel skill.yaml). No sub_agents payload needed —
    // removed DB-based sub-agent query.

    // 2a. Create a thread_turn record so the UI shows normal chat invocations,
    // or reuse the durable mobile turn row when a managed handoff has already
    // claimed ownership.
    if (existingThreadTurnId) {
      turnId = existingThreadTurnId;
      try {
        const now = new Date();
        const [existingTurn] = await db
          .update(threadTurns)
          .set({
            last_activity_at: now,
            context_snapshot: sql`jsonb_set(jsonb_set(coalesce(${threadTurns.context_snapshot}, '{}'::jsonb), '{mobile_turn,managed_invoke_started_at}', to_jsonb(${now.toISOString()}::text), true), '{mobile_turn,managed_checkpoint_seq}', to_jsonb(${event.mobileHandoff?.checkpointSeq ?? 0}::int), true)`,
          })
          .where(
            and(
              eq(threadTurns.id, existingThreadTurnId),
              eq(threadTurns.tenant_id, tenantId),
              eq(threadTurns.status, "running"),
              sql`${threadTurns.finalized_at} IS NULL`,
            ),
          )
          .returning({ id: threadTurns.id });
        if (!existingTurn?.id) {
          console.warn(
            `[chat-agent-invoke] Existing mobile handoff turn is no longer dispatchable: ${existingThreadTurnId}`,
          );
          return { ok: false, threadTurnId: existingThreadTurnId };
        }
        await notifyThreadTurnUpdate({
          runId: turnId,
          tenantId,
          threadId,
          agentId,
          status: "running",
          triggerName: "AgentCore",
        });
        logAgentCorePhase({
          source: "chat-agent-invoke",
          phase: "api.thread_turn.ready",
          status: "completed",
          traceId,
          tenantId,
          agentId,
          threadId,
          threadTurnId: turnId,
          runtimeType,
          detail: "reused",
        });
      } catch (turnErr) {
        console.error(
          `[chat-agent-invoke] Failed to mark existing thread_turn dispatched:`,
          turnErr,
        );
      }
    } else {
      // THINK-324 C5 — pre-dispatch thread checkout. Claim the thread's
      // single-writer lease before creating a competing turn: without it, a
      // quick double-send raced two runtime turns whose durable-session
      // writes collided (the loser logged SessionConflictError but still
      // delivered, silently dropping its exchange from the session). Scope:
      // plain chat turns only — desktop delegations, ask-mode (must never
      // ride the wakeup fallback: retention invariant), computer-task turns,
      // and harness-trial turns keep their existing behavior, as does the
      // mobile-handoff path above (its turn already owns the thread).
      const claimEligible =
        !desktopDelegation &&
        !event.askMode &&
        !event.computerId &&
        !event.computerTaskId &&
        event.requestedRuntime !== "agentcore" &&
        Boolean(event.messageId);
      const candidateTurnId = randomUUID();
      if (claimEligible) {
        let claimed = false;
        try {
          claimed = await claimThreadCheckout({
            tenantId,
            threadId,
            runId: candidateTurnId,
          });
        } catch (claimErr) {
          // Fail open: a claim-infra error must not block chat. The worst
          // case is today's status quo (a racing concurrent turn).
          console.warn(
            `[chat-agent-invoke] Thread checkout claim errored (failing open): thread=${threadId}`,
            claimErr,
          );
          claimed = true;
        }
        if (!claimed) {
          // A live turn holds the thread. Defer this message as a wakeup:
          // the holder's finalize promotes it (promoteNextDeferredWakeup),
          // the stale sweep rescues it if the holder dies, and the promoted
          // turn sees this message in messages_history.
          try {
            await db.insert(agentWakeupRequests).values({
              tenant_id: tenantId,
              agent_id: agentId,
              source: "chat_message",
              reason: "Thread busy — deferred until the running turn ends",
              trigger_detail: `thread:${threadId}:message:${event.messageId}`,
              payload: {
                // TOP-LEVEL threadId — promoteNextDeferredWakeup() matches
                // on payload->>'threadId'; do not nest or rename this key.
                threadId,
                spaceId: spaceId || null,
                messageId: event.messageId,
                userMessage,
                message: userMessage,
                ...(event.requestedModelId
                  ? {
                      modelId: event.requestedModelId,
                      requestedModelId: event.requestedModelId,
                    }
                  : {}),
                ...(event.requestedProfileSlug
                  ? { requestedProfileSlug: event.requestedProfileSlug }
                  : {}),
                ...(event.skillCreatorCommand
                  ? { skillCreatorCommand: event.skillCreatorCommand }
                  : {}),
                ...(event.pendingQuestionAnswers
                  ? { pendingQuestionAnswers: event.pendingQuestionAnswers }
                  : {}),
              },
              status: "deferred",
              idempotency_key: `agent-default:${tenantId}:${event.messageId}:${agentId}:deferred-busy`,
              requested_by_actor_type: "user",
            });
            logAgentCorePhase({
              source: "chat-agent-invoke",
              phase: "api.thread_turn.deferred",
              status: "completed",
              traceId,
              tenantId,
              agentId,
              threadId,
              detail: "thread_busy",
            });
            console.log(
              `[chat-agent-invoke] Thread busy — deferred message as wakeup: thread=${threadId} message=${event.messageId}`,
            );
            return { ok: false, deferred: true, reason: "thread_busy" };
          } catch (deferErr) {
            // Defer-insert failure: fall through and dispatch anyway
            // (status-quo racing beats dropping the message on the floor).
            console.error(
              `[chat-agent-invoke] Deferred-wakeup enqueue failed; dispatching concurrently: thread=${threadId}`,
              deferErr,
            );
          }
        }
      }
      try {
        const [countRow] = await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(threadTurns)
          .where(eq(threadTurns.thread_id, threadId));
        const turnNumber = (countRow?.count || 0) + 1;

        // U2 (plan 2026-08-03-001): the id is always client-generated so
        // wakeup_request_id (= turn id, for cost lookup) folds into this
        // insert instead of a separate follow-up UPDATE.
        const newTurnId = claimEligible ? candidateTurnId : randomUUID();
        const [turnRow] = await db
          .insert(threadTurns)
          .values({
            id: newTurnId,
            wakeup_request_id: newTurnId,
            tenant_id: tenantId,
            agent_id: agentId,
            thread_id: threadId,
            invocation_source: desktopDelegation
              ? "desktop_managed_delegation"
              : "chat_message",
            // THINK-136 U6/KTD3: durable turn→message link for the dispatch
            // indicator. The wakeup-processor path stamps the same field from
            // its payload.messageId — parity enforced by the dispatch-parity
            // test.
            triggering_message_id: event.messageId,
            trigger_detail: desktopDelegation?.reason,
            origin_turn_id: desktopDelegation?.parentThreadTurnId,
            runtime_type: runtimeType,
            status: "running",
            started_at: new Date(),
            last_activity_at: new Date(),
            turn_number: turnNumber,
            context_snapshot: {
              runtime_type: runtimeType,
              model: agentModel,
              ...(requestedParentModel
                ? {
                    requested_model: requestedParentModel,
                  }
                : {}),
              ...(event.requestedRuntime
                ? { requested_runtime: runtimeType }
                : {}),
              agent_slug: agentSlug || undefined,
              space_id: spaceId || undefined,
              dispatcher: desktopDelegation
                ? "desktop-managed-delegation"
                : "chat-agent-invoke",
              desktop_managed_delegation: desktopDelegation
                ? {
                    parent_thread_turn_id: desktopDelegation.parentThreadTurnId,
                    requested_visibility: desktopDelegation.requestedVisibility,
                    visibility: desktopDelegation.effectiveVisibility,
                    reason: desktopDelegation.reason,
                  }
                : undefined,
            },
          })
          .returning({ id: threadTurns.id });
        turnId = turnRow?.id;

        // Notify subscribers that a turn started
        await notifyThreadTurnUpdate({
          runId: turnId!,
          tenantId,
          threadId,
          agentId,
          status: "running",
          triggerName: "AgentCore",
        });
        logAgentCorePhase({
          source: "chat-agent-invoke",
          phase: "api.thread_turn.ready",
          status: "completed",
          traceId,
          tenantId,
          agentId,
          threadId,
          threadTurnId: turnId,
          runtimeType,
          detail: "created",
        });
      } catch (turnErr) {
        console.error(
          `[chat-agent-invoke] Failed to create thread_turn:`,
          turnErr,
        );
        // The claim above may be held for a turn row that never landed —
        // release it so the thread doesn't wait out the stale window.
        if (claimEligible) {
          await releaseThreadCheckout({ threadId, runId: candidateTurnId });
        }
      }
    }

    if (currentUserId) {
      const budgetStatus = await checkUserBudgetAndPauseWork({
        tenantId,
        userId: currentUserId,
      });
      if (budgetStatus.overBudget) {
        const message =
          budgetStatus.pauseReason ??
          "User budget exceeded; this turn was not dispatched.";
        console.log(
          `[chat-agent-invoke] User ${currentUserId} is over budget, skipping dispatch`,
        );
        logAgentCorePhase({
          source: "chat-agent-invoke",
          phase: "api.budget_gate",
          status: "failed",
          traceId,
          tenantId,
          agentId,
          threadId,
          threadTurnId: turnId,
          runtimeType,
          detail: "user_budget_exceeded",
        });
        if (turnId) {
          await markThreadTurnSetupFailed({
            turnId,
            tenantId,
            threadId,
            agentId,
            message,
          });
        }
        const errMsg = await insertAssistantMessage(
          threadId,
          tenantId,
          agentId,
          message,
        );
        if (errMsg) {
          await notifyNewMessage({
            messageId: errMsg.id,
            threadId,
            tenantId,
            role: "assistant",
            content: message,
            senderType: "agent",
            senderId: agentId,
          });
        }
        return { ok: false, threadTurnId: turnId };
      }
    }

    // 2c. Prior conversation history (loaded concurrently in the stage-1
    // Promise.all above — see loadPriorMessageRows for the sourcing notes).
    const messagesHistory = priorMessageRows
      .reverse()
      .filter(
        (m: { role: string | null; content: string | null }) =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.length > 0,
      )
      .map((m: { role: string | null; content: string | null }) => ({
        role: m.role as "user" | "assistant",
        content: m.content as string,
      }));

    console.log(
      `[chat-agent-invoke] Loaded ${messagesHistory.length} prior messages for thread=${threadId}`,
    );
    logAgentCorePhase({
      source: "chat-agent-invoke",
      phase: "api.history.loaded",
      status: "completed",
      traceId,
      tenantId,
      agentId,
      threadId,
      threadTurnId: turnId,
      runtimeType,
      count: messagesHistory.length,
    });

    // MCP configs already resolved by runtimeConfig — except for
    // folder-dispatch agents (THINK-173 U5), whose configs rebuild from
    // the capabilities manifest after the workspace render below.
    const withheldConnections: Array<{ slug: string; detail: string }> = [];
    let mcpConfigs = runtimeConfig.mcpConfigs;
    let effectiveBlockedTools = runtimeConfig.blockedTools;
    let effectiveToolPolicy: EffectiveWorkspacePolicy = {
      blockedTools: runtimeConfig.blockedTools,
      allowedTools: null,
      mcpAllowedServers: null,
      mcpBlockedServers: [],
      modelRouting: [],
      diagnostics: [],
    };
    let renderedWorkspace: RenderWorkspaceTupleForInvokeResult = {
      rendered: false,
      reason: "not_attempted",
    };
    let renderedWorkspacePrefix: string | undefined;
    // U2 (plan 2026-08-03-001, R12): sandbox pre-flight and the turn
    // assertion depend only on state known before the render, so both start
    // here and resolve concurrently with it. Neither promise can reject:
    // the pre-flight wraps its own try/catch and mintTurnAssertion is
    // fail-open (returns null).
    const sandboxPreflightPromise: Promise<SandboxPreflightResult | null> =
      currentUserId && runtimeConfig.sandboxTemplate
        ? (async () => {
            // Sandbox pre-flight (plan Unit 9). Decides whether to register
            // the execute_code tool for this turn. R15-consistent: we use the
            // actual invoker (currentUserId), not agent.human_pair_id — a
            // wakeup-style fallback would hand every webhook-triggered run
            // the agent owner's sandbox tokens.
            try {
              const preflight = await checkSandboxPreflight({
                stage: STAGE,
                tenantId,
                agentId,
                userId: currentUserId,
                templateSandbox: runtimeConfig.sandboxTemplate,
              });
              console.log(
                `[chat-agent-invoke] sandbox pre-flight: ${preflight.status}`,
              );
              logAgentCorePhase({
                source: "chat-agent-invoke",
                phase: "api.sandbox_preflight",
                status: "completed",
                traceId,
                tenantId,
                agentId,
                threadId,
                threadTurnId: turnId,
                runtimeType,
                detail: preflight.status,
              });
              return preflight;
            } catch (err) {
              console.error(
                `[chat-agent-invoke] sandbox pre-flight failed:`,
                err,
              );
              logAgentCorePhase({
                source: "chat-agent-invoke",
                phase: "api.sandbox_preflight",
                status: "failed",
                traceId,
                tenantId,
                agentId,
                threadId,
                threadTurnId: turnId,
                runtimeType,
                errorType: err instanceof Error ? err.name : "Error",
              });
              return null;
            }
          })()
        : Promise.resolve(null);
    const turnAssertionPromise = mintTurnAssertion({
      tenant_id: tenantId,
      thread_id: threadId ?? "",
      turn_id: turnId ?? "",
    });
    if (spaceId) {
      const workspaceRenderStart = Date.now();
      try {
        // Render-skip (U2, plan 2026-08-03-001 / KTD7, R11): reuse the
        // thread's persisted last render only when ALL of (a) the DB-derived
        // routing signature, (b) the config fingerprint computed against the
        // carried manifest, and (c) the S3 mtime probe over the render's own
        // source prefixes agree nothing changed. Any mismatch — or any probe
        // failure — renders exactly as before (fail-closed to render). The
        // signature + probe promises started right after stage 1 (hoisted off
        // the critical path); the probe result is injected into
        // evaluateRenderSkip so it is not re-run here.
        let carriedRender: RenderWorkspaceTupleForInvokeResult | null = null;
        if (lastRenderMarker && routingSignaturePromise) {
          const candidate = renderResultFromLastRenderMarker(lastRenderMarker);
          if (candidate) {
            const probeResult = (await sourceProbePromise) ?? false;
            const decision = await evaluateRenderSkip({
              marker: lastRenderMarker,
              bucket: workspaceBucket() || undefined,
              deps: { probe: async () => probeResult },
              currentRoutingSignature: await routingSignaturePromise,
              currentConfigFingerprint: computeConfigFingerprint(
                {
                  tenantId,
                  agentId,
                  spaceId,
                  agentProfileId: null,
                  perspectiveUserId: currentUserId || null,
                },
                {
                  ...fingerprintInputsFromRuntimeConfig(runtimeConfig),
                  ...fingerprintInputsFromCapabilitiesManifest(
                    candidate.capabilities?.manifest ?? null,
                  ),
                },
              ),
            });
            if (decision.skip) {
              carriedRender = candidate;
            } else {
              console.log(
                `[chat-agent-invoke] render-skip declined: ${decision.reason}`,
              );
            }
          }
        }
        renderedWorkspace =
          carriedRender ??
          (await renderWorkspaceTupleForInvoke({
            tenantId,
            agentId,
            spaceId,
            threadId,
            threadSlug: threadId,
            userId: currentUserId || null,
            agentBlockedTools: runtimeConfig.blockedTools,
          }));
        if (
          !carriedRender &&
          renderedWorkspace.rendered &&
          renderedWorkspace.renderedPrefix &&
          (renderedWorkspace.sourcePrefixes?.length ?? 0) > 0
        ) {
          // Persist the marker that makes the NEXT turn skip-eligible.
          // Best-effort (writeThreadLastRender swallows errors): a lost
          // marker only means the next turn renders.
          await writeThreadLastRender({
            tenantId,
            threadId,
            marker: {
              version: THREAD_LAST_RENDER_VERSION,
              generatedAt: new Date().toISOString(),
              renderedPrefix: renderedWorkspace.renderedPrefix,
              sourcePrefixes: renderedWorkspace.sourcePrefixes ?? [],
              activeSpace: renderedWorkspace.activeSpace,
              effectivePolicy: renderedWorkspace.effectivePolicy,
              capabilities: renderedWorkspace.capabilities
                ? {
                    fingerprint: renderedWorkspace.capabilities.fingerprint,
                    manifest: renderedWorkspace.capabilities.manifest,
                  }
                : undefined,
              hydrateManifest: renderedWorkspace.hydrateManifest,
              routingSignature: await (routingSignaturePromise ??
                computeRoutingSignature({
                  tenantId,
                  agentId,
                  spaceId,
                  userId: currentUserId || null,
                })),
              configFingerprint: computeConfigFingerprint(
                {
                  tenantId,
                  agentId,
                  spaceId,
                  agentProfileId: null,
                  perspectiveUserId: currentUserId || null,
                },
                {
                  ...fingerprintInputsFromRuntimeConfig(runtimeConfig),
                  ...fingerprintInputsFromCapabilitiesManifest(
                    renderedWorkspace.capabilities?.manifest ?? null,
                  ),
                },
              ),
            } satisfies ThreadLastRenderMarker,
          });
        }
        if (renderedWorkspace.rendered) {
          renderedWorkspacePrefix = renderedWorkspace.renderedPrefix;
          effectiveToolPolicy =
            renderedWorkspace.effectivePolicy ?? effectiveToolPolicy;
          effectiveBlockedTools =
            renderedWorkspace.effectivePolicy?.blockedTools ??
            runtimeConfig.blockedTools;
          // U6 (plan 2026-06-12-002): record the dispatch-time workspace
          // projection BEFORE the agent invoke so a crashed turn still
          // carries it. Never fails dispatch — the recorder swallows errors.
          if (turnId && renderedWorkspacePrefix) {
            await recordDispatchWorkspaceProjectionSnapshot({
              threadTurnId: turnId,
              tenantId,
              renderedPrefix: renderedWorkspacePrefix,
              hydrateManifest: renderedWorkspace.hydrateManifest,
              // U7: the turn's effective active skill ids (flag-thread
              // attribution intersects these with installed catalog skills).
              activeSkills: skillsConfig.map((s) => s.skillId),
              source: "chat-agent-invoke",
            });
          }
          console.log(
            `[chat-agent-invoke] rendered workspace tuple space=${renderedWorkspace.activeSpace?.slug ?? spaceId} prefix=${renderedWorkspacePrefix} cache=${renderedWorkspace.cacheStatus ?? "unknown"} duration_ms=${Date.now() - workspaceRenderStart}`,
          );
          logAgentCorePhase({
            source: "chat-agent-invoke",
            phase: "api.workspace_render",
            status: "completed",
            traceId,
            tenantId,
            agentId,
            threadId,
            threadTurnId: turnId,
            runtimeType,
            durationMs: Date.now() - workspaceRenderStart,
            detail: renderedWorkspace.cacheStatus ?? "unknown",
          });
        } else {
          console.log(
            `[chat-agent-invoke] rendered workspace tuple skipped: ${renderedWorkspace.reason} duration_ms=${Date.now() - workspaceRenderStart}`,
          );
          logAgentCorePhase({
            source: "chat-agent-invoke",
            phase: "api.workspace_render",
            status: "skipped",
            traceId,
            tenantId,
            agentId,
            threadId,
            threadTurnId: turnId,
            runtimeType,
            durationMs: Date.now() - workspaceRenderStart,
            detail: renderedWorkspace.reason ?? "not_rendered",
          });
          if (renderedWorkspace.errorCode === "SpaceAccessDenied") {
            throw new Error(
              `workspace_renderer_access_denied:${renderedWorkspace.reason ?? "SpaceAccessDenied"}`,
            );
          }
        }
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.startsWith("workspace_renderer_access_denied:")
        ) {
          console.error(
            `[chat-agent-invoke] rendered workspace tuple denied; aborting turn:`,
            err,
          );
          if (turnId) {
            try {
              await db
                .update(threadTurns)
                .set({
                  status: "failed",
                  finished_at: new Date(),
                  error: err.message,
                })
                .where(eq(threadTurns.id, turnId));
              await notifyThreadTurnUpdate({
                runId: turnId,
                tenantId,
                threadId,
                agentId,
                status: "failed",
                triggerName: "AgentCore",
              });
            } catch (turnErr) {
              console.error(
                `[chat-agent-invoke] Failed to mark denied render turn as failed:`,
                turnErr,
              );
            }
          }
          return;
        }
        console.error(
          `[chat-agent-invoke] rendered workspace tuple failed after ${Date.now() - workspaceRenderStart}ms; falling back to legacy workspace sync:`,
          err,
        );
        logAgentCorePhase({
          source: "chat-agent-invoke",
          phase: "api.workspace_render",
          status: "failed",
          traceId,
          tenantId,
          agentId,
          threadId,
          threadTurnId: turnId,
          runtimeType,
          durationMs: Date.now() - workspaceRenderStart,
          errorType: err instanceof Error ? err.name : "Error",
        });
      }
    }

    // THINK-173 U5 (R20): a folder-dispatch agent's MCP configs come
    // exclusively from the rendered capabilities manifest. The
    // runtime-config resolution above deferred (zero configs), so rebuild
    // here post-render. A missing manifest throws — a flag-on agent must
    // fail the turn loudly, never fall back to the legacy tables (R9).
    if (runtimeConfig.capabilityFolderDispatch) {
      mcpConfigs = await buildMcpConfigs(
        agentId,
        {
          humanPairId: runtimeConfig.humanPairId,
          requesterUserId: currentUserId || null,
        },
        "[chat-agent-invoke]",
        {
          folderCapabilities: {
            manifest: renderedWorkspace.rendered
              ? (renderedWorkspace.capabilities?.manifest ?? null)
              : null,
          },
          // THINK-229 U4 (R8): analyst connections withheld by this
          // build reach the container so delegated children name the
          // outage instead of estimating.
          withheldNotices: withheldConnections,
        },
      );
    }

    const isEffectivelyBlocked = (toolName: string): boolean =>
      effectiveBlockedTools.includes(toolName);
    const isAnyEffectivelyBlocked = (...toolNames: string[]): boolean =>
      toolNames.some((toolName) => isEffectivelyBlocked(toolName));
    const isAnyToolAllowed = (...toolNames: string[]): boolean => {
      if (isAnyEffectivelyBlocked(...toolNames)) return false;
      return toolNames.some((toolName) =>
        isToolAllowed(effectiveToolPolicy, toolName),
      );
    };
    const isSkillAllowedByPolicy = (skill: { skillId: string }): boolean => {
      const aliases = toolPolicyAliases(skill.skillId);
      if (isAnyEffectivelyBlocked(...aliases)) return false;
      if (!isBuiltinToolSlug(skill.skillId)) return true;
      return isAnyToolAllowed(...aliases);
    };
    const effectiveSkillsConfig =
      effectiveBlockedTools.length > 0 || effectiveToolPolicy.allowedTools
        ? skillsConfig.filter(isSkillAllowedByPolicy)
        : skillsConfig;

    // Force-pinned skills (composer slash-command, plan 2026-06-04-004 U3)
    // plus Agent Profile skill policies. Build an ephemeral config branch
    // carrying the catalog s3Key for each pinned slug, then drop any the tool
    // policy blocks — reusing the SAME `isSkillAllowedByPolicy` guardrail as
    // installed skills so an operator/profile pin can never override an admin
    // blocklist (KD4). Kept SEPARATE from `effectiveSkillsConfig` so the runtime
    // can both load uninstalled pins and emphasize all of them, without mutating
    // the resolved/installed set.
    // Subagent-folders U11: profile skill pins are retired — sub-agent
    // skill grants are child grant folders resolved from the manifest;
    // only message-level pins remain on this path.
    const messagePinnedSkillSlugs = Array.isArray(event.pinnedSkills)
      ? event.pinnedSkills
      : [];
    const pinnedSkillSlugs = [...new Set(messagePinnedSkillSlugs)];
    const trustedPinnedSkillIds = await loadTrustedCatalogSkillIds({
      tenantId,
      skillIds: pinnedSkillSlugs,
      logPrefix: "[chat-agent-invoke]",
    });
    const pinnedSkillsConfig = buildPinnedSkillConfigs({
      slugs: pinnedSkillSlugs.filter((slug) => trustedPinnedSkillIds.has(slug)),
      tenantSlug: tenantSlug || "",
      catalogS3Key: tenantCatalogSkillS3Key,
      isAllowed: isSkillAllowedByPolicy,
    });
    if (pinnedSkillSlugs.length > 0) {
      console.log(
        `[chat-agent-invoke] pinned skills requested=${pinnedSkillSlugs.length} message=${messagePinnedSkillSlugs.length} allowed=${pinnedSkillsConfig.length}`,
      );
    }
    // THINK-302 U6 (R21): the space TOOLS.md MCP policy filter is retired —
    // space capability scoping is folder grants, and the folder path's
    // manifest already carries any policy verdict at render time. Resolved MCP
    // configs pass through directly to the explicit-plugin-mention narrowing.
    const policyFilteredMcpConfigs = mcpConfigs;
    const effectiveMcpConfigs = filterMcpConfigsForExplicitPluginMention(
      policyFilteredMcpConfigs,
      userMessage,
    );
    if (effectiveMcpConfigs.length !== policyFilteredMcpConfigs.length) {
      console.log(
        `[chat-agent-invoke] narrowed MCP configs for explicit plugin mention: ${policyFilteredMcpConfigs.length} -> ${effectiveMcpConfigs.length} (${effectiveMcpConfigs.map((config) => config.name ?? "unknown").join(", ")})`,
      );
    }
    const modelRoutingRoutes = effectiveToolPolicy.modelRouting ?? [];
    const modelRoutingPolicy =
      modelRoutingRoutes.length > 0
        ? { routes: modelRoutingRoutes }
        : undefined;
    const approvedModelIds = modelRoutingPolicy
      ? currentUserId
        ? (
            await listApprovedModelCatalog({
              tenantId,
              userId: currentUserId,
            })
          ).map((model) => model.modelId)
        : []
      : undefined;

    // 2d. Call AgentCore Lambda directly via the SDK (no Function URL).
    console.log(
      `[chat-agent-invoke] Invoking AgentCore runtime=${runtimeType} model=${agentModel} skills=${effectiveSkillsConfig.length} mcp=${effectiveMcpConfigs.length}`,
    );

    // THINK-311 (KTD-1/KTD-4): the runtime selector resolves exactly one
    // engine's function name. For a harness-flagged agent this returns the
    // harness runner (U5) — the Pi function is structurally unreachable —
    // and while the runner is unprovisioned it throws
    // RuntimeNotProvisionedError, failing the turn setup loudly (R4: no
    // silent Pi fallback; AE2's structural half).
    // THINK-585 U6 (KTD3): the dispatch seam. Flag-on (stage kill-switch +
    // per-agent flag) targets the agentcore-runtime-dispatch Lambda with the
    // IDENTICAL envelope; flag-off keeps today's Pi Lambda path and logs a
    // legacy_lambda_dispatch sentinel while the stage flag is on.
    const dispatchTarget = resolveChatDispatchTarget({
      runtimeType,
      agentFlagEnabled: runtimeConfig.agentcoreRuntimeDispatch === true,
    });
    const agentcoreFunctionName = dispatchTarget.functionName;
    if (dispatchTarget.kind === "pi_lambda" && dispatchTarget.stageFlagOn) {
      console.log(
        JSON.stringify({
          event: "legacy_lambda_dispatch",
          agentId,
          threadId,
          threadTurnId: turnId,
        }),
      );
    }

    let workflowSkill: unknown = undefined;

    // Started before the render (U2) — resolves concurrently with it.
    const sandboxPreflight: SandboxPreflightResult | null =
      await sandboxPreflightPromise;

    const invokeStart = Date.now();
    const invokePayload = {
      tenant_id: tenantId,
      // Unit 7 tightened `_ensure_workspace_ready` to early-return when
      // `workspace_tenant_id` is empty. chat-agent-invoke was never updated
      // to send it — so the container skipped the composer fetch entirely,
      // `/tmp/workspace` stayed empty, AGENTS.md/USER.md never loaded, and
      // the agent answered from stale default workspace content + a hallucinated identity.
      // Matches eval-runner.ts:276.
      workspace_tenant_id: tenantId,
      assistant_id: agentId,
      thread_id: threadId,
      // R15: only the actual human invoker (message sender / thread creator).
      // Connector-created threads are the narrow exception: they run as the
      // target agent's paired human so Pi receives a user_id for memory/tools.
      // Generic wakeup-style runs still do not fall back to human_pair_id.
      user_id: currentUserId || undefined,
      current_user_email: currentUserEmail || undefined,
      trace_id: traceId,
      message: userMessage,
      messages_history: messagesHistory,
      // THINK-263 U6: a palette "ask" turn suppresses retention. The retain
      // runtime honors ONLY `use_memory === true` as opt-in (anything else
      // skips retain), so sending false here is a zero-handler-change way to
      // meter cost while never writing the ephemeral answer to memory.
      use_memory: resolveTurnUseMemory(event.askMode),
      tenant_slug: tenantSlug || undefined,
      instance_id: agentSlug || undefined,
      agent_name: agent.name,
      system_prompt: runtimeConfig.agentSystemPrompt || undefined,
      human_name: humanName || undefined,
      workspace_bucket: workspaceBucket() || undefined,
      computer_id: event.computerId || undefined,
      computer_task_id: event.computerTaskId || undefined,
      computer_response_mode: "thread_turn",
      web_search_config: isAnyToolAllowed(...toolPolicyAliases("web-search"))
        ? runtimeConfig.webSearchConfig
        : undefined,
      web_extract_config: isAnyToolAllowed(...toolPolicyAliases("web-extract"))
        ? runtimeConfig.webExtractConfig
        : undefined,
      send_email_config:
        runtimeConfig.sendEmailConfig &&
        isAnyToolAllowed(...toolPolicyAliases("send_email"))
          ? { ...runtimeConfig.sendEmailConfig, threadId }
          : undefined,
      // Strands-only legacy gates (always false since Pi became the sole
      // runtime). THINK-311: written as `=== "strands"` so the "harness"
      // trial value cannot flip this dormant capability on.
      context_engine_enabled:
        runtimeConfig.runtimeType === "strands" &&
        runtimeConfig.contextEngineEnabled &&
        isAnyToolAllowed(...toolPolicyAliases("context_engine"))
          ? true
          : undefined,
      context_engine_config:
        runtimeConfig.runtimeType === "strands" &&
        isAnyToolAllowed(...toolPolicyAliases("context_engine"))
          ? runtimeConfig.contextEngineConfig
          : undefined,
      // THINK-321 U5 — identity-resolution tool seam. Stage env flag gates
      // the rollout; the per-agent tool policy can still block it. The
      // runtime additionally requires thread_turn_id / thread id for the
      // turn-bound auth the entity-identity resolvers enforce.
      identity_resolution_enabled:
        IDENTITY_RESOLUTION_TOOL_ENABLED &&
        isAnyToolAllowed(...toolPolicyAliases("resolve_entities"))
          ? true
          : undefined,
      runtime_type: runtimeType,
      model: agentModel,
      requested_model: requestedParentModel || undefined,
      requested_agent_profile_slug: event.requestedProfileSlug || undefined,
      budget_monthly_cents: runtimeConfig.budgetMonthlyCents,
      budget_paused: runtimeConfig.budgetPaused,
      skills:
        effectiveSkillsConfig.length > 0 ? effectiveSkillsConfig : undefined,
      trusted_skill_ids: [
        ...new Set([
          ...effectiveSkillsConfig.map((skill) => skill.skillId),
          ...pinnedSkillsConfig.map((skill) => skill.skillId),
        ]),
      ],
      // Ephemeral force-pinned skills (plan 2026-06-04-004 U3/U4). Separate from
      // `skills` so the runtime loads + emphasizes them for this turn without a
      // permanent install. Already policy-filtered above (KD4).
      pinned_skills:
        pinnedSkillsConfig.length > 0 ? pinnedSkillsConfig : undefined,
      // builder (documented two-builder trap).
      trigger_channel: "chat",
      guardrail_config: guardrailPayload || undefined,
      mcp_configs:
        effectiveMcpConfigs.length > 0 ? effectiveMcpConfigs : undefined,
      workflow_skill: workflowSkill,
      blocked_tools:
        effectiveBlockedTools.length > 0 ? effectiveBlockedTools : undefined,
      browser_automation_enabled:
        runtimeConfig.browserAutomationEnabled &&
        isAnyToolAllowed("browser_automation", "browser")
          ? true
          : undefined,
      thread_json_render_ui_enabled:
        runtimeConfig.threadJsonRenderUiEnabled &&
        isAnyToolAllowed(
          THREAD_JSON_RENDER_UI_CAPABILITY,
          EMIT_JSON_RENDER_UI_TOOL_NAME,
        )
          ? true
          : undefined,
      // U3 of the finance pilot — the runtime reads message_attachments
      // directly off this dict. Convert camelCase → snake_case at the
      // field-shape boundary so runtime adapters see the stable casing.
      message_attachments:
        event.messageAttachments && event.messageAttachments.length > 0
          ? event.messageAttachments.map((att) => ({
              attachment_id: att.attachmentId,
              s3_key: att.s3Key,
              name: att.name,
              mime_type: att.mimeType,
              size_bytes: att.sizeBytes,
            }))
          : undefined,
      // ask_user_question answer context (plan 2026-06-09-005 U3) — same
      // camelCase → snake_case boundary as message_attachments. U4 renders
      // the runtime prompt block from this; here we only deliver the field.
      pending_user_questions: event.pendingQuestionAnswers
        ? toRuntimePendingUserQuestions(event.pendingQuestionAnswers)
        : undefined,
      skill_creator_command: event.skillCreatorCommand,
      cost_owner_user_id: currentUserId || undefined,
      // Dispatch-control fields shared with both wakeup-processor builders
      // (plan 2026-06-12-002 U1). Unit 7: thinkwork_api_url/_secret let the
      // container call /api/workspaces/files at bootstrap. Finalize-callback
      // opt-in (plan 2026-05-22-006 U3): the runtime POSTs its end-of-turn
      // result so chat-agent-invoke can dispatch Event-mode; eval-runner /
      // agentcore-direct keep their synchronous response path. NEVER add a
      // dispatch-critical field inline here — add it to the helper so the
      // wakeup paths get it too (the parity test enforces this).
      ...buildAgentDispatchControlFields({
        // U2: both promises started in the setup stages above; the values
        // still come exclusively from documentPlatesForDispatch(tenantId) /
        // memberSpacesForDispatch(tenantId, currentUserId) — the dispatch-
        // parity test pins the assignment sites.
        documentPlates: await documentPlatesPromise,
        // THINK-261 #6: member spaces for recall fan-out + scope labels.
        memberSpaces: await memberSpacesPromise,
        thinkworkApiUrl: thinkworkApiUrl(),
        apiAuthSecret,
        threadId,
        threadTurnId: turnId,
        withheldConnections,
        piExtensions: runtimeConfig.piExtensions,
        modelRoutingPolicy,
        approvedModelIds,
        renderedWorkspacePrefix,
        turnContext: spaceId
          ? {
              spaceId: renderedWorkspace.activeSpace?.id ?? spaceId,
              tenantSlug: tenantSlug || undefined,
              spaceSlug: renderedWorkspace.activeSpace?.slug ?? spaceSlug,
            }
          : null,
        includeFinalizeCallback: true,
        // KTD-3: same fingerprint function the capability inspector stamps
        // on predicted sets; the container forwards it into the per-turn
        // manifest so R15 divergence is only asserted on matching config.
        // Presence of this field IS the runtime's folder-mode signal —
        // it ships only for flag-on agents (THINK-173 U6 contract).
        capabilitiesManifestFingerprint:
          runtimeConfig.capabilityFolderDispatch && renderedWorkspace.rendered
            ? renderedWorkspace.capabilities?.fingerprint
            : undefined,
        turnAssertion: await turnAssertionPromise,
        configFingerprint: computeConfigFingerprint(
          {
            tenantId,
            agentId,
            spaceId: spaceId ?? null,
            agentProfileId: null,
            perspectiveUserId: currentUserId || null,
          },
          {
            ...fingerprintInputsFromRuntimeConfig(runtimeConfig),
            // THINK-173 U5: folder capabilities project from the SAME
            // manifest on both dispatch paths (parity helper).
            ...fingerprintInputsFromCapabilitiesManifest(
              renderedWorkspace.rendered
                ? (renderedWorkspace.capabilities?.manifest ?? null)
                : null,
            ),
          },
        ),
      }),
    } as Record<string, unknown>;

    if (sandboxPreflight && currentUserId) {
      invokePayload.sandbox_status = sandboxPreflight.status;
      invokePayload.sandbox_reason =
        "reason" in sandboxPreflight ? sandboxPreflight.reason : undefined;
      applySandboxPayloadFields(invokePayload, sandboxPreflight);
      if (sandboxPreflight.status !== "ready") {
        console.log(
          `[chat-agent-invoke] sandbox not registered for this turn: ${sandboxPreflight.status}`,
          sandboxPreflight.status === "provisioning"
            ? { environment: sandboxPreflight.environment }
            : {},
        );
      }
    }

    // The agentcore container runs an HTTP server behind Lambda Web Adapter;
    // POSTs must be wrapped in an API Gateway v2-style event targeting /invocations.
    const lambdaEventPayload = JSON.stringify({
      requestContext: { http: { method: "POST", path: "/invocations" } },
      rawPath: "/invocations",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(invokePayload),
      isBase64Encoded: false,
    });

    // Event-mode dispatch (plan 2026-05-22-006 U3). The runtime
    // owns the post-AgentCore bookkeeping via the finalize-callback POST
    // wired in U2; chat-agent-invoke just sets up the payload, fires
    // AgentCore Event-mode, and returns. The SDK call resolves once AWS
    // has queued the event (~tens of ms) — there is no per-turn wait
    // anymore, so the 5-min Lambda timeout / auto-retry cascade is gone.
    //
    // Any synchronous failure here (throttling, IAM, function-not-found)
    // throws from `lambdaClient.send` — the outer catch handles it. AWS
    // does NOT route Event-mode FunctionErrors back; those land in the
    // DLQ wired in handlers.tf.
    try {
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName: agentcoreFunctionName,
          InvocationType: "Event",
          Payload: new TextEncoder().encode(lambdaEventPayload),
        }),
      );
      console.log(
        `[chat-agent-invoke] AgentCore Event-mode dispatch accepted in ${Date.now() - invokeStart}ms`,
      );
      logAgentCorePhase({
        source: "chat-agent-invoke",
        phase: "api.agentcore.dispatch",
        status: "completed",
        traceId,
        tenantId,
        agentId,
        threadId,
        threadTurnId: turnId,
        runtimeType,
        durationMs: Date.now() - invokeStart,
        detail: `setup=${Date.now() - setupStart}ms`,
      });
      return { ok: true, threadTurnId: turnId };
    } catch (dispatchErr) {
      const errMsgText = `AgentCore dispatch failed: ${dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr)}`;
      console.error(`[chat-agent-invoke] ${errMsgText}`);
      logAgentCorePhase({
        source: "chat-agent-invoke",
        phase: "api.agentcore.dispatch",
        status: "failed",
        traceId,
        tenantId,
        agentId,
        threadId,
        threadTurnId: turnId,
        runtimeType,
        durationMs: Date.now() - invokeStart,
        errorType: dispatchErr instanceof Error ? dispatchErr.name : "Error",
      });
      await markComputerTaskFailedFromFinalize({
        tenantId,
        computerId: event.computerId,
        taskId: event.computerTaskId,
        threadId,
        messageId: event.messageId,
        message: errMsgText,
        code: "agentcore_dispatch_failed",
      });
      if (turnId) {
        try {
          await db
            .update(threadTurns)
            .set({
              status: "failed",
              finished_at: new Date(),
              error: errMsgText,
            })
            .where(eq(threadTurns.id, turnId));
        } catch (turnErr) {
          console.error(
            `[chat-agent-invoke] Failed to mark turn=${turnId} as failed:`,
            turnErr,
          );
        }
      }
      const errMsg = await insertAssistantMessage(
        threadId,
        tenantId,
        agentId,
        GENERIC_AGENT_ERROR_MESSAGE,
      );
      if (errMsg) {
        await notifyNewMessage({
          messageId: errMsg.id,
          threadId,
          tenantId,
          role: "assistant",
          content: GENERIC_AGENT_ERROR_MESSAGE,
          senderType: "agent",
          senderId: agentId,
        });
      }
      return;
    }
  } catch (err) {
    // Outer setup error path. The original handler had a very large
    // try/catch wrapping the entire flow; with the post-AgentCore body
    // gone, the only paths that reach here are pre-dispatch setup
    // failures (agent lookup, runtime config resolve, etc.).
    console.error(`[chat-agent-invoke] Setup error:`, err);
    if (turnId) {
      await markThreadTurnSetupFailed({
        turnId,
        tenantId,
        threadId,
        agentId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
}

/**
 * Load prior conversation history for a thread from Aurora. The runtime
 * container no longer has a working source of session memory (AgentCore
 * Memory was retired in PRD-41B Phase 3 — store_turn became a no-op, so
 * list_events returns nothing). The `messages` table is the source of truth,
 * and history ships inline in the invoke payload. Cap at 30 turns: long
 * enough for real conversation memory, short enough to keep payloads
 * reasonable.
 */
async function loadPriorMessageRows(input: {
  threadId: string;
  messageId?: string;
}): Promise<Array<{ role: string | null; content: string | null }>> {
  const HISTORY_LIMIT = 30;
  const historyConditions = [eq(messages.thread_id, input.threadId)];
  if (input.messageId) {
    // ne() generates a properly-typed uuid comparison; raw sql interpolation
    // would bind the messageId as `text`, which Postgres rejects against the
    // uuid column with `operator does not exist: uuid <> text`.
    historyConditions.push(ne(messages.id, input.messageId));
  }
  return db
    .select({
      role: messages.role,
      content: messages.content,
    })
    .from(messages)
    .where(and(...historyConditions))
    .orderBy(sql`${messages.created_at} desc`)
    .limit(HISTORY_LIMIT);
}

async function resolveThreadSpaceContext(input: {
  tenantId: string;
  threadId: string;
}): Promise<{ spaceId: string; spaceSlug: string | null } | null> {
  const [thread] = await db
    .select({ spaceId: threads.space_id })
    .from(threads)
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.tenant_id, input.tenantId),
      ),
    )
    .limit(1);
  if (!thread?.spaceId) return null;

  const [space] = await db
    .select({ slug: spaces.slug })
    .from(spaces)
    .where(
      and(eq(spaces.tenant_id, input.tenantId), eq(spaces.id, thread.spaceId)),
    )
    .limit(1);
  return { spaceId: thread.spaceId, spaceSlug: space?.slug ?? null };
}
