/**
 * Wakeup Processor Lambda
 *
 * Runs on the EventBridge schedule declared in Terraform (currently once per
 * minute). Polls `agent_wakeup_requests` for queued work, claims it, creates a
 * `scheduled_job_runs` record, dispatches to AgentCore, and records the outcome.
 *
 * Interactive chat should prefer `chat-agent-invoke` and use this queue only as
 * a fallback/background path. Timer heartbeats, thread assignment, comment
 * triggers, approval decisions, and on-demand wakeups still flow through here.
 */

import {
  deriveFunctionName,
  getConfig,
  getApiAuthSecret,
  getAppsyncApiKey,
} from "@thinkwork/runtime-config";
import { randomBytes } from "crypto";
import { eq, and, sql, asc, desc, inArray } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agentWakeupRequests,
  agentCapabilities,
  threadTurns,
  threadTurnEvents,
  threads,
  agents,
  agentTemplates,
  agentKnowledgeBases,
  knowledgeBases,
  guardrails,
  messages,
  spaces,
  artifacts,
  tenants,
  users,
  costEvents,
  agentWorkspaceRuns,
  threadAttachments,
} from "@thinkwork/database-pg/schema";
import {
  extractUsage,
  recordCostEvents,
  checkBudgetAndPause,
  notifyCostRecorded,
} from "../lib/cost-recording.js";
import { checkUserBudgetAndPauseWork } from "../lib/user-budget-enforcement.js";
import { buildMcpConfigs } from "../lib/mcp-configs.js";
import { applyWorkspaceMcpPolicyFilter } from "../lib/plugins/gating.js";
import { loadTenantBuiltinTools } from "./skills.js";
import {
  applySandboxPayloadFields,
  checkSandboxPreflight,
  type SandboxPreflightResult,
  type TemplateSandboxConfig,
} from "../lib/sandbox-preflight.js";
import { validateTemplateBrowser } from "../lib/templates/browser-config.js";
import { validateTemplateContextEngine } from "../lib/templates/context-engine-config.js";
import { validateTemplateSendEmail } from "../lib/templates/send-email-config.js";
import { validateTemplateWebExtract } from "../lib/templates/web-extract-config.js";
import { validateTemplateWebSearch } from "../lib/templates/web-search-config.js";
import { resolveWebSearchConfigFromSkills } from "../lib/web-search-config.js";
import { loadTenantWebExtractConfig } from "../lib/builtin-tools/web-extract.js";
import { ensureThreadForWork } from "../lib/thread-helpers.js";
import {
  isThreadBlocked,
  checkConcurrencyLimits,
} from "../lib/thread-dispatch.js";
import { promoteNextDeferredWakeup } from "../lib/wakeup-defer.js";
import {
  isWorkspaceProjectionManifestLike,
  recordDispatchWorkspaceProjectionSnapshot,
  type WorkspaceProjectionManifestLike,
} from "../lib/workspace-projection-snapshot.js";
import {
  resolveWorkflowConfig,
  renderPromptTemplate,
} from "../lib/orchestration/index.js";
import {
  normalizeWorkspaceWakeupPayload,
  type NormalizedWorkspaceWakeupPayload,
} from "../lib/workspace-events/wakeup-payload.js";
import { WORKSPACE_TURN_IN_FLIGHT_STATUSES } from "../lib/workspace-events/run-lifecycle.js";
import type { PromptTemplateContext } from "../lib/orchestration/index.js";
import {
  normalizeAgentRuntimeType,
  resolveRuntimeFunctionName,
  type AgentRuntimeType,
} from "../lib/resolve-runtime-function-name.js";
import {
  isToolAllowed,
  spaceTriggerServiceIdentity,
  type EffectiveWorkspacePolicy,
} from "../lib/workspace-renderer/index.js";
import { isBuiltinToolSlug } from "../lib/builtin-tool-slugs.js";
import { toolPolicyAliases } from "../lib/builtin-tool-policy-aliases.js";
import {
  applyAgentSkillMetadata,
  loadAgentProfileRuntimeConfigs,
  loadWorkspaceSkillConfigs,
  type AgentProfileRuntimeConfig,
} from "../lib/resolve-agent-runtime-config.js";
import { buildAgentDispatchControlFields } from "../lib/agent-dispatch-payload.js";
import {
  filterBlockedSkills,
  resolveDispatchPinnedSkills,
} from "../lib/skills/message-pinned-skills.js";
import {
  prependThreadProgressPromptBlock,
  readThreadProgressMarkdown,
} from "../lib/thread-progress/storage.js";
import {
  prependThreadGoalPromptBlock,
  readThreadGoalFile,
  readThreadGoalPromptFiles,
} from "../lib/thread-goals/storage.js";
import {
  assertUserModelApproved,
  listApprovedModelCatalog,
  ModelApprovalError,
} from "../lib/model-approvals.js";
import { normalizeRequestedModelId } from "../lib/turn-model-selection.js";
import {
  pendingQuestionAnswersFromPayload,
  toRuntimePendingUserQuestions,
} from "../lib/user-questions/runtime-payload.js";

// Config-class values are read at call time via getConfig (env-wins merge
// over the SSM document) — never captured at module load (R3): the SSM
// document may load after module init, and vitest stubs env after import.
// Secret-class values are read at call time via getApiAuthSecret /
// getAppsyncApiKey — never captured at module load. The remaining
// process.env reads stay as-is until their own migration unit.
const AGENTCORE_INVOKE_URL = process.env.AGENTCORE_INVOKE_URL || "";
function appsyncEndpoint(): string {
  return getConfig("APPSYNC_ENDPOINT", "");
}
const MCP_BASE_URL = process.env.MCP_BASE_URL || "";
const MCP_AUTH_SECRET = process.env.MCP_AUTH_SECRET || "";
const AGENTCORE_GATEWAY_URL = process.env.AGENTCORE_GATEWAY_URL || "";
function workspaceBucket(): string {
  return getConfig("WORKSPACE_BUCKET", "");
}
function thinkworkApiUrl(): string {
  return getConfig("THINKWORK_API_URL") || process.env.MCP_BASE_URL || "";
}
function hindsightEndpoint(): string {
  return getConfig("HINDSIGHT_ENDPOINT", "");
}
function workspaceRendererFunctionName(): string {
  // Derived from the per-stage naming convention (R7); a config/env
  // override still wins. "" preserves the legacy unconfigured guard
  // path for non-Lambda contexts without STAGE (vitest).
  const explicit = getConfig("WORKSPACE_RENDERER_FUNCTION_NAME");
  if (explicit) return explicit;
  return process.env.STAGE ? deriveFunctionName("workspace-renderer") : "";
}

/**
 * Wakeup sources whose response handling ALREADY inserts the assistant
 * message in a source-specific branch above the catch-all. Any source in
 * this list must be excluded from the catch-all insert or the turn's
 * response is persisted twice (duplicate assistant message).
 * `question_answer` resumes reply into the chat thread via the same
 * branch as `chat_message` — keep all three chat-flow sources in sync
 * with that branch's condition.
 */
export const SOURCES_WITH_MESSAGES = [
  "chat_message",
  "automation",
  "question_answer",
  "email_triage",
  "email_received",
  "webhook",
];

function tenantCatalogSkillS3Key(tenantSlug: string, skillId: string): string {
  return `tenants/${tenantSlug}/skill-catalog/${skillId}`;
}

function tenantCatalogSkillFileS3Key(
  tenantSlug: string,
  skillId: string,
  relativePath: string,
): string {
  return `${tenantCatalogSkillS3Key(tenantSlug, skillId)}/${relativePath}`;
}
// Stage namespace for the sandbox Secrets Manager paths.
const STAGE = process.env.STAGE || process.env.STACK_NAME || "dev";
const BATCH_SIZE = 10;
const BROWSER_AUTOMATION_CAPABILITY = "browser_automation";

/**
 * Invoke AgentCore via Lambda SDK (direct invoke) or HTTP fetch (Function URL).
 * Pi is the only active runtime; legacy runtime selectors are normalized before
 * this path.
 */
export async function invokeAgentCore(
  payload: Record<string, unknown>,
  runtimeType: AgentRuntimeType = "pi",
): Promise<{ ok: boolean; status: number; result: Record<string, unknown> }> {
  let functionName = "";
  try {
    functionName = resolveRuntimeFunctionName(runtimeType);
  } catch (err) {
    return {
      ok: false,
      status: 503,
      result: {
        error: err instanceof Error ? err.message : String(err),
        runtime_type: normalizeAgentRuntimeType(runtimeType),
      },
    };
  }

  if (functionName) {
    const { LambdaClient, InvokeCommand } =
      await import("@aws-sdk/client-lambda");
    const lambda = new LambdaClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    const lambdaPayload = JSON.stringify({
      requestContext: { http: { method: "POST", path: "/invocations" } },
      rawPath: "/invocations",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      isBase64Encoded: false,
    });
    const resp = await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(lambdaPayload),
      }),
    );
    const respBody = resp.Payload
      ? new TextDecoder().decode(resp.Payload)
      : "{}";
    const parsed = JSON.parse(respBody) as Record<string, unknown>;
    // Lambda Web Adapter returns {statusCode, body, headers}
    const statusCode = (parsed.statusCode as number) || 200;
    const bodyStr = (parsed.body as string) || respBody;
    const result = JSON.parse(bodyStr) as Record<string, unknown>;
    return {
      ok: statusCode >= 200 && statusCode < 300,
      status: statusCode,
      result,
    };
  }

  // Fallback to HTTP fetch
  const apiAuthSecret = getApiAuthSecret();
  const resp = await fetch(AGENTCORE_INVOKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiAuthSecret ? { Authorization: `Bearer ${apiAuthSecret}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    return { ok: false, status: resp.status, result: { error: errText } };
  }
  const result = (await resp.json()) as Record<string, unknown>;
  return { ok: true, status: 200, result };
}

interface RenderWorkspaceTupleForWakeupResult {
  rendered: boolean;
  renderedPrefix?: string;
  cacheStatus?: "hit" | "miss";
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
  errorCode?: string;
  statusCode?: number;
  reason?: string;
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
    (obj.modelRouting === undefined || Array.isArray(obj.modelRouting)) &&
    isStringArray(obj.diagnostics)
  );
}

export async function renderWorkspaceTupleForWakeup(input: {
  tenantId: string;
  agentId: string;
  spaceId: string;
  threadId?: string | null;
  threadSlug?: string | null;
  userId?: string | null;
  invokingServiceIdentity?: string | null;
  agentBlockedTools?: unknown;
  agentAllowedTools?: unknown;
}): Promise<RenderWorkspaceTupleForWakeupResult> {
  if (!workspaceRendererFunctionName()) {
    return { rendered: false, reason: "workspace_renderer_unconfigured" };
  }

  const { LambdaClient, InvokeCommand } =
    await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: workspaceRendererFunctionName(),
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(
        JSON.stringify({
          tenantId: input.tenantId,
          agentId: input.agentId,
          spaceId: input.spaceId,
          threadId: input.threadId ?? null,
          threadSlug: input.threadSlug ?? input.threadId ?? null,
          userId: input.userId ?? null,
          invokingServiceIdentity: input.invokingServiceIdentity ?? null,
          agentBlockedTools: input.agentBlockedTools,
          agentAllowedTools: input.agentAllowedTools,
        }),
      ),
    }),
  );

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

  const activeSpace =
    parsed.activeSpace && typeof parsed.activeSpace === "object"
      ? (parsed.activeSpace as RenderWorkspaceTupleForWakeupResult["activeSpace"])
      : undefined;

  return {
    rendered: true,
    renderedPrefix: parsed.renderedPrefix,
    cacheStatus:
      parsed.cacheStatus === "hit" || parsed.cacheStatus === "miss"
        ? parsed.cacheStatus
        : undefined,
    activeSpace,
    effectivePolicy: isEffectiveWorkspacePolicy(parsed.effectivePolicy)
      ? parsed.effectivePolicy
      : undefined,
    hydrateManifest: isWorkspaceProjectionManifestLike(parsed.hydrateManifest)
      ? parsed.hydrateManifest
      : undefined,
  };
}

export function extractComposedSystemPrompt(
  result: Record<string, unknown>,
): string | null {
  const response =
    result.response && typeof result.response === "object"
      ? (result.response as Record<string, unknown>)
      : null;
  for (const candidate of [
    result.composed_system_prompt,
    response?.composed_system_prompt,
  ]) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

const db = getDb();

export async function loadChatMessageAttachmentContext(input: {
  tenantId: string;
  threadId: string;
  messageId: string;
}) {
  const [message] = await db
    .select({ metadata: messages.metadata })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, input.threadId),
        eq(messages.id, input.messageId),
      ),
    )
    .limit(1);

  const currentIds = new Set(parseAttachmentIdsFromMetadata(message?.metadata));
  const rows = await db
    .select({
      id: threadAttachments.id,
      s3Key: threadAttachments.s3_key,
      name: threadAttachments.name,
      mimeType: threadAttachments.mime_type,
      sizeBytes: threadAttachments.size_bytes,
      createdAt: threadAttachments.created_at,
    })
    .from(threadAttachments)
    .where(
      and(
        eq(threadAttachments.tenant_id, input.tenantId),
        eq(threadAttachments.thread_id, input.threadId),
      ),
    )
    .orderBy(asc(threadAttachments.created_at), asc(threadAttachments.id));

  return {
    messageAttachments: rows
      .filter((row) => currentIds.has(row.id) && row.s3Key)
      .map((row) => ({
        attachment_id: row.id,
        s3_key: row.s3Key,
        name: row.name,
        mime_type: row.mimeType,
        size_bytes: row.sizeBytes,
      })),
    threadAttachmentManifest: rows.map((row) => ({
      attachment_id: row.id,
      name: row.name,
      mime_type: row.mimeType,
      size_bytes: row.sizeBytes,
      created_at: row.createdAt?.toISOString?.() ?? String(row.createdAt),
      staged_on_this_turn: currentIds.has(row.id),
    })),
  };
}

function parseAttachmentIdsFromMetadata(metadata: unknown): string[] {
  const record = parseJsonRecord(metadata);
  const attachments = Array.isArray(record.attachments)
    ? record.attachments
    : [];
  const ids: string[] = [];
  for (const entry of attachments) {
    const attachment = parseJsonRecord(entry);
    if (typeof attachment.attachmentId === "string") {
      ids.push(attachment.attachmentId.toLowerCase());
    }
  }
  return ids;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function handler(): Promise<{
  processed: number;
  errors: number;
}> {
  let processed = 0;
  let errors = 0;

  // 1. Fetch queued wakeup requests (oldest first)
  const queued = await db
    .select()
    .from(agentWakeupRequests)
    .where(eq(agentWakeupRequests.status, "queued"))
    .orderBy(asc(agentWakeupRequests.created_at))
    .limit(BATCH_SIZE);

  if (queued.length === 0) return { processed: 0, errors: 0 };

  console.log(
    `[wakeup-processor] Found ${queued.length} queued wakeup requests`,
  );

  for (const wakeup of queued) {
    try {
      await processWakeup(wakeup);
      processed++;
    } catch (err) {
      errors++;
      console.error(
        `[wakeup-processor] Failed to process wakeup ${wakeup.id}:`,
        err,
      );
      // Mark as failed
      await db
        .update(agentWakeupRequests)
        .set({ status: "failed", finished_at: new Date() })
        .where(eq(agentWakeupRequests.id, wakeup.id));
    }
  }

  console.log(
    `[wakeup-processor] Done: processed=${processed} errors=${errors}`,
  );
  return { processed, errors };
}

// ---------------------------------------------------------------------------
// Process a single wakeup request
// ---------------------------------------------------------------------------

interface WakeupRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  source: string;
  trigger_detail: string | null;
  reason: string | null;
  payload: unknown;
  status: string;
  // Invoker attribution. `requested_by_actor_type` is one of
  // `user` | `system` | `agent` | null. Only `user` produces a
  // downstream CURRENT_USER_ID; the others leave invokerUserId
  // undefined so the admin skill's R15 "no invoker" refusal fires.
  requested_by_actor_type: string | null;
  requested_by_actor_id: string | null;
}

export function serviceIdentityForWebhookSpaceWakeup(input: {
  tenantId: string;
  source: string;
  triggerDetail: string | null;
  requestedByActorType: string | null;
  spaceId?: string | null;
  payload: Record<string, unknown> | null;
}): string | null {
  if (input.source !== "webhook") return null;
  if (input.requestedByActorType !== "system") return null;
  const spaceId = stringValue(input.spaceId);
  if (!spaceId) return null;
  const payloadSpaceId = stringValue(input.payload?.spaceId);
  if (payloadSpaceId !== spaceId) return null;
  const webhookId = stringValue(input.payload?.webhookId);
  if (!webhookId) return null;
  if (input.triggerDetail !== `webhook:${webhookId}`) return null;
  return spaceTriggerServiceIdentity({ tenantId: input.tenantId, spaceId });
}

export function shouldInsertSyntheticWakeupUserMessage(input: {
  source: string;
  payload: Record<string, unknown> | null;
}): boolean {
  if (input.source === "chat_message") return false;
  if (input.source === "question_answer") return false;
  if (
    input.source === "webhook" &&
    input.payload?.openingMessageAlreadyPersisted === true
  ) {
    return false;
  }
  return true;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function processWakeup(wakeup: WakeupRow): Promise<void> {
  const now = new Date();

  // Derive the honest invoker for this wakeup. Only "user" actors get a
  // CURRENT_USER_ID plumbed through; "system" and "agent" actors produce
  // undefined so the admin skill's R15 "no invoker" refusal triggers.
  const invokerUserId =
    wakeup.requested_by_actor_type === "user" && wakeup.requested_by_actor_id
      ? wakeup.requested_by_actor_id
      : undefined;

  // 2. Atomically claim — only succeed if still queued
  const [claimed] = await db
    .update(agentWakeupRequests)
    .set({ status: "claimed", claimed_at: now })
    .where(
      and(
        eq(agentWakeupRequests.id, wakeup.id),
        eq(agentWakeupRequests.status, "queued"),
      ),
    )
    .returning();

  if (!claimed) {
    console.log(
      `[wakeup-processor] Wakeup ${wakeup.id} already claimed, skipping`,
    );
    return;
  }

  // 3. Look up agent + its template (model, guardrail, blocked tools, sandbox
  // all live on agent_templates)
  const [agent] = await db
    .select({
      adapter_type: agents.adapter_type,
      runtime: agents.runtime,
      template_runtime: agentTemplates.runtime,
      model: agents.model,
      template_model: agentTemplates.model,
      name: agents.name,
      slug: agents.slug,
      system_prompt: agents.system_prompt,
      human_pair_id: agents.human_pair_id,
      runtime_config: agents.runtime_config,
      budget_paused: agents.budget_paused,
      guardrail_id: agentTemplates.guardrail_id,
      blocked_tools: agentTemplates.blocked_tools,
      sandbox: agentTemplates.sandbox,
      browser: agentTemplates.browser,
      web_search: agentTemplates.web_search,
      web_extract: agentTemplates.web_extract,
      send_email: agentTemplates.send_email,
      context_engine: agentTemplates.context_engine,
    })
    .from(agents)
    .leftJoin(agentTemplates, eq(agents.template_id, agentTemplates.id))
    .where(eq(agents.id, wakeup.agent_id));

  if (!agent) {
    console.error(`[wakeup-processor] Agent not found: ${wakeup.agent_id}`);
    await failWakeup(wakeup.id, "Agent not found");
    return;
  }

  const payload = wakeup.payload as Record<string, unknown> | null;
  const runtimeType = normalizeAgentRuntimeType(
    agent.runtime ?? agent.template_runtime,
  );
  const fallbackAgentModel = agent.model ?? agent.template_model ?? null;
  let agentModel = fallbackAgentModel;
  const requestedParentModel =
    normalizeRequestedModelId(payload?.modelId) ??
    normalizeRequestedModelId(payload?.requestedModelId);
  if (requestedParentModel && wakeup.source === "chat_message") {
    if (
      wakeup.requested_by_actor_type !== "user" ||
      !wakeup.requested_by_actor_id
    ) {
      await failWakeupBeforeRun({
        wakeup,
        payload,
        error: "Requester user identity required for selected model.",
        runtimeType,
        model: requestedParentModel,
      });
      return;
    }
    try {
      await assertUserModelApproved({
        tenantId: wakeup.tenant_id,
        userId: wakeup.requested_by_actor_id,
        modelId: requestedParentModel,
      });
      agentModel = requestedParentModel;
    } catch (err) {
      if (err instanceof ModelApprovalError) {
        await failWakeupBeforeRun({
          wakeup,
          payload,
          error: err.message,
          runtimeType,
          model: requestedParentModel,
        });
        return;
      }
      throw err;
    }
  }

  // PRD-02: Pre-invocation budget gate
  if (agent.budget_paused) {
    const error = "Agent paused: budget exceeded";
    console.log(
      `[wakeup-processor] Agent ${wakeup.agent_id} is budget-paused, skipping`,
    );
    await failWakeupBeforeRun({
      wakeup,
      payload,
      error,
      runtimeType,
      model: agentModel,
    });
    return;
  }

  // Look up tenant slug for workspace path
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, wakeup.tenant_id));
  const tenantSlug = tenant?.slug || "";
  const agentSlug = agent.slug || "";

  // Look up human pair name for personality file bootstrap
  let humanName = "";
  if (agent.human_pair_id) {
    const [human] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, agent.human_pair_id));
    humanName = human?.name || "";
  }

  let currentUserEmail = "";
  let currentUserName = "";
  let costOwnerUserId: string | undefined;
  if (invokerUserId) {
    const [currentUser] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(
        and(eq(users.id, invokerUserId), eq(users.tenant_id, wakeup.tenant_id)),
      );
    currentUserEmail = currentUser?.email || "";
    currentUserName = currentUser?.name || "";
    costOwnerUserId = currentUser ? invokerUserId : undefined;
  }

  if (costOwnerUserId) {
    const budgetStatus = await checkUserBudgetAndPauseWork({
      tenantId: wakeup.tenant_id,
      userId: costOwnerUserId,
    });
    if (budgetStatus.overBudget) {
      const error =
        budgetStatus.pauseReason ??
        "User budget exceeded; wakeup was not dispatched.";
      console.log(
        `[wakeup-processor] User ${invokerUserId} is over budget, skipping wakeup ${wakeup.id}`,
      );
      await failWakeupBeforeRun({
        wakeup,
        payload,
        error,
        runtimeType,
        model: agentModel,
      });
      return;
    }
  }

  // Resolve Bedrock guardrail: class-level → tenant default → none
  let guardrailPayload:
    | { guardrailIdentifier: string; guardrailVersion: string }
    | undefined;
  if (agent.guardrail_id) {
    const [gr] = await db
      .select({
        bedrock_guardrail_id: guardrails.bedrock_guardrail_id,
        bedrock_version: guardrails.bedrock_version,
      })
      .from(guardrails)
      .where(eq(guardrails.id, agent.guardrail_id));
    if (gr?.bedrock_guardrail_id && gr?.bedrock_version) {
      guardrailPayload = {
        guardrailIdentifier: gr.bedrock_guardrail_id,
        guardrailVersion: gr.bedrock_version,
      };
    }
  } else {
    const [defaultGr] = await db
      .select({
        bedrock_guardrail_id: guardrails.bedrock_guardrail_id,
        bedrock_version: guardrails.bedrock_version,
      })
      .from(guardrails)
      .where(
        and(
          eq(guardrails.tenant_id, wakeup.tenant_id),
          eq(guardrails.is_default, true),
        ),
      );
    if (defaultGr?.bedrock_guardrail_id && defaultGr?.bedrock_version) {
      guardrailPayload = {
        guardrailIdentifier: defaultGr.bedrock_guardrail_id,
        guardrailVersion: defaultGr.bedrock_version,
      };
    }
  }

  const blockedTools: string[] = (agent.blocked_tools as string[] | null) || [];
  const templateBrowserResult = validateTemplateBrowser(agent.browser);
  const templateBrowserEnabled = templateBrowserResult.ok
    ? templateBrowserResult.value?.enabled === true
    : false;
  if (!templateBrowserResult.ok) {
    console.warn(
      `[wakeup-processor] Invalid template browser config ignored for agent ${wakeup.agent_id}: ${templateBrowserResult.error}`,
    );
  }
  const templateWebSearchResult = validateTemplateWebSearch(agent.web_search);
  const templateWebSearchEnabled = templateWebSearchResult.ok
    ? templateWebSearchResult.value?.enabled === true
    : false;
  if (!templateWebSearchResult.ok) {
    console.warn(
      `[wakeup-processor] Invalid template webSearch config ignored for agent ${wakeup.agent_id}: ${templateWebSearchResult.error}`,
    );
  }
  const templateWebExtractResult = validateTemplateWebExtract(
    agent.web_extract,
  );
  const templateWebExtractEnabled = templateWebExtractResult.ok
    ? templateWebExtractResult.value?.enabled === true
    : false;
  if (!templateWebExtractResult.ok) {
    console.warn(
      `[wakeup-processor] Invalid template webExtract config ignored for agent ${wakeup.agent_id}: ${templateWebExtractResult.error}`,
    );
  }
  const templateSendEmailResult = validateTemplateSendEmail(agent.send_email);
  const templateSendEmailEnabled = templateSendEmailResult.ok
    ? templateSendEmailResult.value?.enabled === true
    : false;
  if (!templateSendEmailResult.ok) {
    console.warn(
      `[wakeup-processor] Invalid template sendEmail config ignored for agent ${wakeup.agent_id}: ${templateSendEmailResult.error}`,
    );
  }
  const templateContextEngineResult = validateTemplateContextEngine(
    agent.context_engine,
  );
  const templateContextEngineEnabled = templateContextEngineResult.ok
    ? templateContextEngineResult.value?.enabled === true
    : false;
  if (!templateContextEngineResult.ok) {
    console.warn(
      `[wakeup-processor] Invalid template contextEngine config ignored for agent ${wakeup.agent_id}: ${templateContextEngineResult.error}`,
    );
  }

  let skillsConfig = await loadWorkspaceSkillConfigs({
    tenantSlug,
    agentSlug,
    logPrefix: "[wakeup-processor]",
  });
  skillsConfig = await applyAgentSkillMetadata({
    skillsConfig,
    agentId: wakeup.agent_id,
    tenantId: wakeup.tenant_id,
    logPrefix: "[wakeup-processor]",
  });

  const workspacePayload =
    wakeup.source === "workspace_event"
      ? normalizeWorkspaceWakeupPayload(payload)
      : null;
  if (
    wakeup.source === "workspace_event" &&
    !workspacePayload?.workspaceRunId
  ) {
    throw new Error(
      "workspace_event wakeup payload missing required workspaceRunId",
    );
  }

  // Default skills: always available for all agents (parity with chat-agent-invoke).
  // web-search is NOT in this list — it's opt-in via tenant_builtin_tools below.
  const defaultSkills = [
    { skillId: "agent-thread-management" },
    { skillId: "artifacts" },
    { skillId: "workspace-memory" },
  ];
  for (const ds of defaultSkills) {
    if (!skillsConfig.some((s) => s.skillId === ds.skillId)) {
      const env: Record<string, string> = {
        THINKWORK_API_URL: thinkworkApiUrl(),
        THINKWORK_API_SECRET: getApiAuthSecret(),
        GRAPHQL_API_KEY: getAppsyncApiKey(),
        AGENT_ID: wakeup.agent_id,
      };
      skillsConfig.push({
        ...ds,
        s3Key: tenantCatalogSkillS3Key(tenantSlug, ds.skillId),
        secretRef: undefined,
        envOverrides: env,
        mcpServer: undefined,
      });
    }
  }

  // Tenant-configured built-in tools (web-search, …): only injected when a row
  // exists with enabled=true AND a usable API key in Secrets Manager.
  try {
    const builtinTools = await loadTenantBuiltinTools(wakeup.tenant_id);
    for (const bt of builtinTools) {
      if (bt.toolSlug === "web-search" && !templateWebSearchEnabled) {
        continue;
      }
      // If a hand-installed agent_skills row already provided this tool,
      // overlay our env overrides onto it so the provider + key still win.
      const existing = skillsConfig.find((s) => s.skillId === bt.toolSlug);
      if (existing) {
        existing.envOverrides = {
          ...(existing.envOverrides || {}),
          ...bt.envOverrides,
        };
        console.log(
          `[wakeup-processor] Overlaid env for built-in tool '${bt.toolSlug}' (provider=${bt.provider})`,
        );
        continue;
      }
      skillsConfig.push({
        skillId: bt.toolSlug,
        s3Key: tenantCatalogSkillS3Key(tenantSlug, bt.toolSlug),
        secretRef: undefined,
        envOverrides: bt.envOverrides,
        mcpServer: undefined,
      });
      console.log(
        `[wakeup-processor] Injected built-in tool '${bt.toolSlug}' (provider=${bt.provider})`,
      );
    }
  } catch (err) {
    console.warn(
      `[wakeup-processor] Failed to load tenant built-in tools:`,
      err,
    );
  }

  // Apply class tool_access policy — remove blocked skills
  if (blockedTools.length > 0) {
    const before = skillsConfig.length;
    skillsConfig = skillsConfig.filter(
      (s) => !blockedTools.includes(s.skillId),
    );
    const removed = before - skillsConfig.length;
    if (removed > 0) {
      console.log(
        `[wakeup-processor] Class tool_access: removed ${removed} blocked skill(s)`,
      );
    }
  }

  // Look up agent's assigned knowledge bases (PRD-13)
  const kbRows = await db
    .select({
      aws_kb_id: knowledgeBases.aws_kb_id,
      name: knowledgeBases.name,
      description: knowledgeBases.description,
      search_config: agentKnowledgeBases.search_config,
    })
    .from(agentKnowledgeBases)
    .innerJoin(
      knowledgeBases,
      eq(agentKnowledgeBases.knowledge_base_id, knowledgeBases.id),
    )
    .where(
      and(
        eq(agentKnowledgeBases.agent_id, wakeup.agent_id),
        eq(agentKnowledgeBases.enabled, true),
      ),
    )
    .then((rows) => rows.filter((r) => r.aws_kb_id));

  const knowledgeBasesConfig =
    kbRows.length > 0
      ? kbRows.map((kb) => ({
          awsKbId: kb.aws_kb_id,
          name: kb.name,
          description: kb.description,
          searchConfig: kb.search_config,
        }))
      : undefined;

  const capabilityRows = await db
    .select({
      capability: agentCapabilities.capability,
      enabled: agentCapabilities.enabled,
      config: agentCapabilities.config,
    })
    .from(agentCapabilities)
    .where(
      and(
        eq(agentCapabilities.agent_id, wakeup.agent_id),
        eq(agentCapabilities.tenant_id, wakeup.tenant_id),
      ),
    );
  const browserCapability = capabilityRows.find(
    (row) => row.capability === BROWSER_AUTOMATION_CAPABILITY,
  );
  const browserAutomationEnabled =
    !blockedTools.includes(BROWSER_AUTOMATION_CAPABILITY) &&
    (browserCapability
      ? browserCapability.enabled === true
      : templateBrowserEnabled);
  const sendEmailConfig =
    templateSendEmailEnabled && !blockedTools.includes("send_email")
      ? {
          agentId: wakeup.agent_id,
          tenantId: wakeup.tenant_id,
          apiUrl: thinkworkApiUrl(),
          apiSecret: getApiAuthSecret(),
          inboundMessageId: (payload?.originalMessageId as string) || "",
          inboundSubject: (payload?.subject as string) || "",
          inboundFrom: (payload?.from as string) || "",
          inboundBody: (payload?.body as string) || "",
        }
      : undefined;
  const contextEngineEnabled =
    templateContextEngineEnabled &&
    !blockedTools.includes("query_context") &&
    !blockedTools.includes("context_engine");
  const contextEngineConfig = contextEngineEnabled
    ? templateContextEngineResult.ok
      ? (templateContextEngineResult.value ?? undefined)
      : undefined
    : undefined;
  const messageId =
    typeof payload?.messageId === "string" ? payload.messageId : null;

  // 4. Create trigger_run record
  // Extract trigger_id from trigger_detail if present (e.g. "manual_fire:trigger:UUID" or "schedule:job-XXX")
  let triggerId: string | null = null;
  if (payload?.triggerId) {
    triggerId = String(payload.triggerId);
  } else if (wakeup.trigger_detail) {
    const triggerMatch = wakeup.trigger_detail.match(/trigger:([0-9a-f-]{36})/);
    if (triggerMatch) triggerId = triggerMatch[1];
  }

  // Look up trigger name for notifications
  let triggerName: string | null = null;
  if (triggerId) {
    const { triggers } = await import("@thinkwork/database-pg/schema");
    const [trig] = await db
      .select({ name: triggers.name })
      .from(triggers)
      .where(eq(triggers.id, triggerId));
    triggerName = trig?.name ?? null;
  }

  // PRD-15: Resolve thread_id for this turn
  let runThreadId = String(payload?.threadId || "") || undefined;

  // Fallback: if no thread was provided (e.g., job-trigger failed to create one), create one now
  if (
    !runThreadId &&
    wakeup.agent_id &&
    (wakeup.source === "trigger" ||
      wakeup.source === "on_demand" ||
      wakeup.source === "timer")
  ) {
    try {
      const triggerName = String(
        payload?.triggerId || wakeup.trigger_detail || "",
      ).slice(0, 8);
      const result = await ensureThreadForWork({
        tenantId: wakeup.tenant_id,
        agentId: wakeup.agent_id,
        title: agent.name
          ? `${agent.name} — ${triggerName}`
          : `Scheduled run ${triggerName}`,
        channel: "schedule",
      });
      runThreadId = result.threadId;
      console.log(
        `[wakeup-processor] Created fallback thread ${result.identifier} for wakeup ${wakeup.id}`,
      );
    } catch (err) {
      console.warn("[wakeup-processor] Failed to create fallback thread:", err);
    }
  }

  let turnNumber: number | undefined;
  if (runThreadId) {
    try {
      const [c] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(threadTurns)
        .where(eq(threadTurns.thread_id, runThreadId));
      turnNumber = (c?.count || 0) + 1;
    } catch {}
  }

  // PRD-09 §9.1.6: Skip if thread is blocked by unresolved dependencies
  if (runThreadId) {
    try {
      const blocked = await isThreadBlocked(runThreadId);
      if (blocked) {
        console.log(
          `[wakeup-processor] Thread ${runThreadId} is blocked by dependencies, skipping wakeup ${wakeup.id}`,
        );
        await db.insert(threadTurns).values({
          tenant_id: wakeup.tenant_id,
          agent_id: wakeup.agent_id,
          trigger_id: triggerId,
          wakeup_request_id: wakeup.id,
          invocation_source: wakeup.source,
          trigger_detail: wakeup.trigger_detail,
          status: "skipped",
          started_at: now,
          finished_at: now,
          error: "blocked_by_dependencies",
          thread_id: runThreadId,
          turn_number: turnNumber,
        });
        await db
          .update(agentWakeupRequests)
          .set({ status: "skipped", finished_at: now })
          .where(eq(agentWakeupRequests.id, wakeup.id));
        return;
      }
    } catch (err) {
      console.warn(
        "[wakeup-processor] Blocking check failed, proceeding:",
        err,
      );
    }
  }

  // PRD-09 §9.3.3: Concurrency gate — skip thread_assignment wakeups at capacity
  // Never block chat_message wakeups
  if (wakeup.source === "thread_assignment" || wakeup.source === "automation") {
    try {
      const concurrencyResult = await checkConcurrencyLimits(
        wakeup.tenant_id,
        wakeup.agent_id,
      );
      if (!concurrencyResult.allowed) {
        console.log(
          `[wakeup-processor] Concurrency limit reached for agent ${wakeup.agent_id}: ${concurrencyResult.reason}, skipping wakeup ${wakeup.id}`,
        );
        await db.insert(threadTurns).values({
          tenant_id: wakeup.tenant_id,
          agent_id: wakeup.agent_id,
          trigger_id: triggerId,
          wakeup_request_id: wakeup.id,
          invocation_source: wakeup.source,
          trigger_detail: wakeup.trigger_detail,
          status: "skipped",
          started_at: now,
          finished_at: now,
          error: `concurrency_limit: ${concurrencyResult.reason}`,
          thread_id: runThreadId,
          turn_number: turnNumber,
        });
        await db
          .update(agentWakeupRequests)
          .set({ status: "skipped", finished_at: now })
          .where(eq(agentWakeupRequests.id, wakeup.id));
        return;
      }
    } catch (err) {
      console.warn(
        "[wakeup-processor] Concurrency check failed, proceeding:",
        err,
      );
    }
  }

  // PRD-09 §9.4.2: Auto-inject agent-thread-management skill for orchestration-enabled agents
  const orchConfig = ((agent.runtime_config as Record<string, unknown>) || {})
    .orchestration as Record<string, unknown> | undefined;
  if (orchConfig?.threadManagement && runThreadId) {
    const hasThreadSkill = skillsConfig.some(
      (s) => s.skillId === "agent-thread-management",
    );
    if (!hasThreadSkill) {
      skillsConfig.push({
        skillId: "agent-thread-management",
        s3Key: tenantCatalogSkillS3Key(tenantSlug, "agent-thread-management"),
        secretRef: undefined,
        mcpServer: undefined,
        envOverrides: {
          THINKWORK_API_URL: appsyncEndpoint(),
          THINKWORK_API_SECRET: getAppsyncApiKey(),
          AGENT_ID: wakeup.agent_id,
          TENANT_ID: wakeup.tenant_id,
          CURRENT_THREAD_ID: runThreadId,
        },
      });
    }
  }

  // PRD-22: Process template materialization
  // On first wakeup for a skill with PROCESS.md, materialize the template into sub-threads.
  if (runThreadId) {
    // Check if already materialized (has children = not first wakeup)
    const [childCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(threads)
      .where(eq(threads.parent_id, runThreadId));

    if ((childCount?.count || 0) === 0) {
      try {
        const { parseProcessTemplate } =
          await import("../lib/orchestration/process-parser.js");
        const { materializeProcess } =
          await import("../lib/orchestration/process-materializer.js");
        const { S3Client, GetObjectCommand } =
          await import("@aws-sdk/client-s3");

        const s3 = new S3Client({});
        let processSkill: (typeof skillsConfig)[number] | null = null;
        let processMarkdown: string | null = null;

        for (const skill of skillsConfig) {
          const s3Paths = Array.from(
            new Set(
              [
                skill.s3Key
                  ? `${skill.s3Key.replace(/\/$/, "")}/PROCESS.md`
                  : "",
                tenantCatalogSkillFileS3Key(
                  tenantSlug,
                  skill.skillId,
                  "PROCESS.md",
                ),
              ].filter(Boolean),
            ),
          );

          for (const s3Path of s3Paths) {
            try {
              const resp = await s3.send(
                new GetObjectCommand({
                  Bucket: workspaceBucket(),
                  Key: s3Path,
                }),
              );
              processMarkdown = (await resp.Body?.transformToString()) || null;
              if (processMarkdown) {
                processSkill = skill;
                break;
              }
            } catch {
              /* try next path */
            }
          }

          if (processMarkdown) break;
        }

        if (processMarkdown && processSkill) {
          const template = parseProcessTemplate(processMarkdown);
          await materializeProcess({
            template,
            parentThreadId: runThreadId,
            agentId: wakeup.agent_id,
            tenantId: wakeup.tenant_id,
          });
          console.log(
            `[wakeup-processor] Process template materialized for thread ${runThreadId} from skill ${processSkill.skillId}`,
          );
        }
      } catch (err) {
        console.error(
          `[wakeup-processor] Process materialization failed:`,
          err,
        );
      }
    }
  }

  // PRD-09 §9.2.6: Carry retry metadata if this is a retry wakeup
  const retryAttempt = (payload?.retryAttempt as number) || 0;
  const originTurnId = (payload?.originTurnId as string) || undefined;

  // PRD-09 Batch 3: Resolve workflow config for turn loop + workspace isolation
  const workflowConfig = await resolveWorkflowConfig(wakeup.tenant_id);

  // PRD-09 Batch 3: Build workspace prefix with optional per-thread isolation
  let workspacePrefix = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
  if (workflowConfig.workspace.isolateByThread && runThreadId) {
    workspacePrefix = `tenants/${tenantSlug}/agents/${agentSlug}/threads/${runThreadId}/`;
  } else if (workflowConfig.workspace.prefixTemplate) {
    workspacePrefix = workflowConfig.workspace.prefixTemplate
      .replace("{tenantSlug}", tenantSlug)
      .replace("{agentSlug}", agentSlug);
  }

  const [run] = await db
    .insert(threadTurns)
    .values({
      tenant_id: wakeup.tenant_id,
      agent_id: wakeup.agent_id,
      trigger_id: triggerId,
      wakeup_request_id: wakeup.id,
      invocation_source: wakeup.source,
      trigger_detail: wakeup.trigger_detail,
      runtime_type: runtimeType,
      status: "running",
      started_at: now,
      last_activity_at: now,
      retry_attempt: retryAttempt,
      origin_turn_id: originTurnId,
      context_snapshot: {
        ...((wakeup.payload as Record<string, unknown> | undefined) ?? {}),
        runtime_type: runtimeType,
        model: agentModel,
        ...(requestedParentModel && agentModel === requestedParentModel
          ? {
              requested_model: requestedParentModel,
              fallback_model: fallbackAgentModel,
            }
          : {}),
      },
      thread_id: runThreadId || undefined,
      turn_number: turnNumber || undefined,
    })
    .returning();

  // Link run back to wakeup
  await db
    .update(agentWakeupRequests)
    .set({ run_id: run.id })
    .where(eq(agentWakeupRequests.id, wakeup.id));

  if (wakeup.source === "workspace_event" && workspacePayload?.workspaceRunId) {
    await db
      .update(agentWorkspaceRuns)
      .set({
        status: "processing",
        current_wakeup_request_id: wakeup.id,
        current_thread_turn_id: run.id,
        last_event_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(agentWorkspaceRuns.id, workspacePayload.workspaceRunId),
          eq(agentWorkspaceRuns.tenant_id, wakeup.tenant_id),
          eq(agentWorkspaceRuns.agent_id, wakeup.agent_id),
          inArray(agentWorkspaceRuns.status, ["pending", "claimed"]),
        ),
      );
  }

  // Notify subscribers that a run started
  await notifyThreadTurnUpdate({
    runId: run.id,
    triggerId,
    tenantId: wakeup.tenant_id,
    threadId: runThreadId || null,
    agentId: wakeup.agent_id || null,
    status: "running",
    triggerName,
  });

  // Log start event
  await insertRunEvent(
    run.id,
    wakeup.tenant_id,
    wakeup.agent_id || null,
    1,
    "started",
    {
      source: wakeup.source,
      reason: wakeup.reason,
    },
  );

  // 5. Build message and invoke AgentCore
  const reason = wakeup.reason || wakeup.source;
  let agentMessage: string;

  switch (wakeup.source) {
    case "chat_message":
    case "automation": {
      // Chat message — use the user's message directly
      agentMessage = String(
        payload?.userMessage || payload?.message || "New message received",
      );
      break;
    }
    case "thread_assignment": {
      let threadContext = "";
      if (runThreadId) {
        try {
          const { threads } = await import("@thinkwork/database-pg/schema");
          const [t] = await db
            .select({ title: threads.title, metadata: threads.metadata })
            .from(threads)
            .where(eq(threads.id, runThreadId));
          if (t) {
            threadContext = `\n\nThread: ${t.title}`;
            const instructions = (
              t.metadata as { processStepInstructions?: string } | null
            )?.processStepInstructions;
            if (instructions) {
              threadContext += `\n\n${instructions}`;
            }
          }
        } catch (err) {
          console.warn(
            `[wakeup-processor] Failed to load thread context:`,
            err,
          );
        }
      }
      agentMessage = `You have been assigned a thread.${threadContext}`;
      break;
    }
    case "issue_commented":
    case "issue_comment_mentioned": {
      agentMessage = `A comment was added to your thread. Comment ID: ${payload?.commentId}. Thread ID: ${payload?.threadId}. Please review and respond.`;
      break;
    }
    case "inbox_item_decided": {
      const status = payload?.status || "unknown";
      agentMessage = `An approval you requested has been ${status}. Inbox Item ID: ${payload?.inboxItemId}. Please take appropriate action.`;
      break;
    }
    case "timer":
    case "heartbeat_timer": {
      agentMessage =
        "Heartbeat timer triggered. Check for pending work in your thread inbox.";
      break;
    }
    case "question_answer": {
      // ask_user_question card-route resume (plan 2026-06-09-005 U3). The
      // structured answer context travels in the payload and reaches the
      // runtime as `pending_user_questions` — U4 renders the actual
      // answer block; this message just frames the resume.
      agentMessage =
        "The user answered your pending question. Continue the task using the structured answers provided in this turn's context.";
      break;
    }
    case "on_demand":
    case "trigger": {
      agentMessage = String(
        payload?.message ||
          "You have been manually woken up. Check for pending work.",
      );
      break;
    }
    case "email_triage": {
      agentMessage =
        "Check for new inbox messages using the google-email skill, classify them, create tasks for actionable items, and post a summary.";
      break;
    }
    case "email_received": {
      const from = (payload?.from as string) || "unknown";
      const subject = (payload?.subject as string) || "(no subject)";
      const body = (payload?.body as string) || "";
      agentMessage = [
        "You received an email. Process this and respond appropriately.",
        "",
        "[EMAIL_CONTENT_START]",
        `From: ${from}`,
        `Subject: ${subject}`,
        `Body: ${body}`,
        "[EMAIL_CONTENT_END]",
        "",
        "If you need to reply, use the send_email tool with mode='reply'.",
      ].join("\n");
      break;
    }
    case "webhook": {
      const webhookPayload = payload?.webhookPayload;
      const promptText = String(payload?.message || "");
      agentMessage = [
        promptText ||
          "A webhook was triggered. Process the payload and respond appropriately.",
        "",
        "[WEBHOOK_PAYLOAD_START]",
        typeof webhookPayload === "object"
          ? JSON.stringify(webhookPayload, null, 2)
          : String(webhookPayload ?? "{}"),
        "[WEBHOOK_PAYLOAD_END]",
      ].join("\n");
      break;
    }
    case "workspace_event": {
      const workspaceRunId = workspacePayload?.workspaceRunId ?? "";
      const targetPath = workspacePayload?.targetPath ?? ".";
      const requestObjectKey = workspacePayload?.requestObjectKey ?? "";
      const causeType = workspacePayload?.causeType ?? "workspace_event";
      agentMessage = [
        "You were woken by a workspace file event.",
        "",
        `Workspace run: ${workspaceRunId}`,
        `Target: ${targetPath || "."}`,
        `Cause: ${causeType}`,
        requestObjectKey ? `Request object: ${requestObjectKey}` : "",
        "",
        "Read the run folder from workspace storage, continue from the durable files, write any result or lifecycle intent through the workspace tools, then exit.",
      ]
        .filter(Boolean)
        .join("\n");
      break;
    }
    default: {
      agentMessage = `Wakeup triggered: ${reason || wakeup.source}`;
    }
  }

  // Load thread context — used by prompt template rendering, trigger channel
  // resolution, and rendered workspace tuple selection for chat turns.
  let threadContext: PromptTemplateContext["thread"] | undefined;
  let runSpaceId = String(payload?.spaceId || "") || undefined;
  let runSpaceSlug = String(payload?.spaceSlug || "") || undefined;
  if (runThreadId) {
    try {
      const [threadRow] = await db
        .select({
          identifier: threads.identifier,
          title: threads.title,
          status: threads.status,
          channel: threads.channel,
          space_id: threads.space_id,
          metadata: threads.metadata,
        })
        .from(threads)
        .where(eq(threads.id, runThreadId));
      if (threadRow) {
        runSpaceId ||= threadRow.space_id ?? undefined;
        threadContext = {
          id: runThreadId,
          identifier: threadRow.identifier || undefined,
          title: threadRow.title,
          status: threadRow.status,
          channel: threadRow.channel,
        };
      }
    } catch {}
  }
  if (runSpaceId && !runSpaceSlug) {
    try {
      const [spaceRow] = await db
        .select({ slug: spaces.slug })
        .from(spaces)
        .where(
          and(
            eq(spaces.tenant_id, wakeup.tenant_id),
            eq(spaces.id, runSpaceId),
          ),
        )
        .limit(1);
      runSpaceSlug = spaceRow?.slug ?? undefined;
    } catch {}
  }

  // PRD-09 Batch 4: Render prompt template if configured
  if (workflowConfig.promptTemplate) {
    const rendered = renderPromptTemplate(workflowConfig.promptTemplate, {
      tenant: { id: wakeup.tenant_id, slug: tenantSlug },
      agent: { id: wakeup.agent_id, slug: agentSlug, name: agent.name },
      thread: threadContext,
      source: wakeup.source,
    });
    if (rendered) {
      agentMessage = `${rendered}\n\n---\n\n${agentMessage}`;
    }
  }

  let renderedWorkspace: RenderWorkspaceTupleForWakeupResult = {
    rendered: false,
    reason: "not_attempted",
  };
  let renderedWorkspacePrefix: string | undefined;
  let effectiveBlockedTools = blockedTools;
  let effectiveToolPolicy: EffectiveWorkspacePolicy = {
    blockedTools,
    allowedTools: null,
    mcpAllowedServers: null,
    mcpBlockedServers: [],
    modelRouting: [],
    diagnostics: [],
  };
  let effectiveMcpPolicy: EffectiveWorkspacePolicy | null = null;
  if (runSpaceId) {
    try {
      renderedWorkspace = await renderWorkspaceTupleForWakeup({
        tenantId: wakeup.tenant_id,
        agentId: wakeup.agent_id,
        spaceId: runSpaceId,
        threadId: runThreadId ?? null,
        threadSlug: runThreadId ?? null,
        userId: costOwnerUserId ?? null,
        invokingServiceIdentity: serviceIdentityForWebhookSpaceWakeup({
          tenantId: wakeup.tenant_id,
          source: wakeup.source,
          triggerDetail: wakeup.trigger_detail,
          requestedByActorType: wakeup.requested_by_actor_type,
          spaceId: runSpaceId,
          payload,
        }),
        agentBlockedTools: blockedTools,
      });
      if (renderedWorkspace.rendered) {
        renderedWorkspacePrefix = renderedWorkspace.renderedPrefix;
        effectiveMcpPolicy = renderedWorkspace.effectivePolicy ?? null;
        effectiveToolPolicy =
          renderedWorkspace.effectivePolicy ?? effectiveToolPolicy;
        effectiveBlockedTools =
          renderedWorkspace.effectivePolicy?.blockedTools ?? blockedTools;
        // U6 (plan 2026-06-12-002): record the dispatch-time workspace
        // projection BEFORE the agent invoke — same shape as the
        // chat-agent-invoke path (dispatch parity). Never fails dispatch —
        // the recorder swallows errors.
        if (renderedWorkspacePrefix) {
          await recordDispatchWorkspaceProjectionSnapshot({
            threadTurnId: run.id,
            tenantId: wakeup.tenant_id,
            renderedPrefix: renderedWorkspacePrefix,
            hydrateManifest: renderedWorkspace.hydrateManifest,
            // U7: same shape as chat-agent-invoke (dispatch parity) — the
            // turn's effective active skill ids, via the shared writer.
            activeSkills: skillsConfig.map((s) => s.skillId),
            source: "wakeup-processor",
          });
        }
        console.log(
          `[wakeup-processor] rendered workspace tuple space=${renderedWorkspace.activeSpace?.slug ?? runSpaceId} prefix=${renderedWorkspacePrefix} cache=${renderedWorkspace.cacheStatus ?? "unknown"}`,
        );
      } else {
        console.log(
          `[wakeup-processor] rendered workspace tuple skipped: ${renderedWorkspace.reason}`,
        );
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
        throw err;
      }
      console.error(
        `[wakeup-processor] rendered workspace tuple failed; falling back to legacy workspace sync:`,
        err,
      );
    }
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
  const effectiveWebSearchConfig = isAnyToolAllowed(
    ...toolPolicyAliases("web-search"),
  )
    ? resolveWebSearchConfigFromSkills(effectiveSkillsConfig)
    : undefined;
  const webExtractConfig =
    templateWebExtractEnabled &&
    isAnyToolAllowed(...toolPolicyAliases("web-extract"))
      ? await loadTenantWebExtractConfig(wakeup.tenant_id)
      : null;
  const effectiveWebExtractConfig = webExtractConfig ?? undefined;
  const effectiveSendEmailConfig =
    sendEmailConfig && isAnyToolAllowed(...toolPolicyAliases("send_email"))
      ? sendEmailConfig
      : undefined;
  const effectiveContextEngineEnabled =
    contextEngineEnabled &&
    isAnyToolAllowed(...toolPolicyAliases("context_engine"));
  const effectiveContextEngineConfig = effectiveContextEngineEnabled
    ? contextEngineConfig
    : undefined;
  // Plan 2026-06-09-004 U8 — graph tool parity with chat-agent-invoke:
  // wakeup turns get knowledge_graph_search under the same stage env flag
  // and per-agent tool policy.
  const effectiveKnowledgeGraphEnabled =
    (process.env.KNOWLEDGE_GRAPH_TOOL_ENABLED || "").toLowerCase() === "true" &&
    isAnyToolAllowed(...toolPolicyAliases("knowledge_graph_search"));
  const effectiveBrowserAutomationEnabled =
    browserAutomationEnabled &&
    isAnyToolAllowed("browser_automation", "browser");

  // Resolve thread_id — for email_triage, use the dedicated triage thread
  let resolvedThreadId = String(payload?.threadId || "");
  if (wakeup.source === "email_triage" && !resolvedThreadId) {
    const rc = (agent.runtime_config as Record<string, unknown>) || {};
    const pc = (rc.productivityConfig as Record<string, unknown>) || {};
    resolvedThreadId = (pc.triageChatThreadId as string) || "";
  }
  if (wakeup.source === "email_received" && !resolvedThreadId) {
    const replyCtxId = payload?.replyTokenContextId as string | undefined;
    if (replyCtxId) resolvedThreadId = replyCtxId;
  }

  // Build MCP server list from agent's skills + defaults
  // Thinkwork tools route directly via MCP_BASE_URL.
  // External tools route through Gateway (single-endpoint pattern).
  // Include all MCP servers — the container routes them appropriately:
  // Thinkwork tools → MCP_BASE_URL; external tools use their configured server.
  const mcpServers = ["web-search", "artifacts"];
  for (const skill of effectiveSkillsConfig) {
    if (skill.mcpServer && !mcpServers.includes(skill.mcpServer)) {
      mcpServers.push(skill.mcpServer);
    }
  }
  // Include always-available Thinkwork tools
  if (!mcpServers.includes("thread-management"))
    mcpServers.push("thread-management");
  if (!mcpServers.includes("email-send")) mcpServers.push("email-send");
  if (!mcpServers.includes("workspace-memory"))
    mcpServers.push("workspace-memory");
  // Include Google tools when the agent has those skills installed
  if (
    effectiveSkillsConfig.some((s) => s.skillId === "google-email") &&
    !mcpServers.includes("google-email")
  ) {
    mcpServers.push("google-email");
  }
  if (
    effectiveSkillsConfig.some((s) => s.skillId === "google-calendar") &&
    !mcpServers.includes("google-calendar")
  ) {
    mcpServers.push("google-calendar");
  }
  if (
    effectiveSkillsConfig.some(
      (s) => s.skillId === "restaurant-reservations",
    ) &&
    !mcpServers.includes("restaurant")
  ) {
    mcpServers.push("restaurant");
  }

  // Build MCP configs from agent_mcp_servers + tenant_mcp_servers.
  // Dispatch identity (plan 2026-06-12-001 U6): plugin-managed servers
  // gate on the wakeup's honest invoker (`requested_by_actor_type='user'`
  // → requested_by_actor_id, i.e. the thread/job owner). System/agent
  // actors leave requesterUserId null → plugin servers drop (fail
  // closed). Direct per_user_oauth servers keep human-pair semantics.
  const mcpConfigsRaw = await buildMcpConfigs(
    wakeup.agent_id,
    {
      humanPairId: agent.human_pair_id,
      requesterUserId: invokerUserId ?? null,
    },
    "[wakeup-processor]",
  );
  // Shared chokepoint (U7): the TOOLS.md MCP policy filter is the same
  // function chat-agent-invoke applies — the two builders cannot drift.
  const mcpConfigs = applyWorkspaceMcpPolicyFilter(
    mcpConfigsRaw,
    effectiveMcpPolicy,
  );

  // Dispatch-control parity with chat-agent-invoke (plan 2026-06-12-002 U1):
  // agent_profiles / model routing resolve exactly the way the chat path
  // does — profiles from the tenant's enabled rows (Space-filtered), routing
  // from the rendered workspace's effective TOOLS.md policy, approved models
  // for the actual invoker (R15: never the agent's human pair). Profile
  // loading is best-effort: a resolver failure ships `[]`, not a dead turn.
  const modelRoutingRoutes = effectiveToolPolicy.modelRouting ?? [];
  // Model routing enforcement requires an approvable invoker: the runtime's
  // assertModelRouteApproved throws MODEL_ROUTE_UNAPPROVED for any routed
  // model missing from approved_model_ids. System/agent-actor wakeups
  // (scheduled jobs, automations) have no invoking user, so no approval
  // list can be resolved — shipping the policy with `[]` approvals would
  // fail EVERY routed skill/MCP call on automation turns that ran unrouted
  // before the policy reached the wakeup path. Preserve that pre-policy
  // behavior: omit model_routing_policy AND approved_model_ids entirely for
  // non-user actors; user-actor wakeups carry the full policy plus the
  // invoker's approved catalog (chat parity).
  const modelRoutingPolicy =
    invokerUserId && modelRoutingRoutes.length > 0
      ? { routes: modelRoutingRoutes }
      : undefined;
  // Profiles + approved catalog are independent lookups — resolve them
  // concurrently. Per-arm semantics preserved: profile resolution stays
  // best-effort (failure → `[]`), catalog failure still fails the wakeup.
  const [agentProfilesConfig, approvedModelIds] = await Promise.all([
    loadAgentProfileRuntimeConfigs({
      tenantId: wakeup.tenant_id,
      spaceId: renderedWorkspace.activeSpace?.id ?? runSpaceId ?? null,
      mcpConfigs: mcpConfigsRaw,
      logPrefix: "[wakeup-processor]",
    }).catch((err): AgentProfileRuntimeConfig[] => {
      console.error(`[wakeup-processor] Agent profile resolution failed:`, err);
      return [];
    }),
    modelRoutingPolicy && invokerUserId
      ? listApprovedModelCatalog({
          tenantId: wakeup.tenant_id,
          userId: invokerUserId,
        }).then((models) => models.map((model) => model.modelId))
      : Promise.resolve(undefined),
  ]);

  const startMs = Date.now();
  // Generate trace ID for observability correlation (PRD-20)
  const xrayTraceId = process.env._X_AMZN_TRACE_ID;
  const traceId =
    xrayTraceId?.match(/Root=([^;]+)/)?.[1] || randomBytes(16).toString("hex");

  // Insert synthetic user message for non-chat sources so all thread types
  // have a consistent user → assistant message flow in the timeline.
  // For chat_message source, sendMessage.mutation.ts already inserted the user
  // message. For question_answer, the answered card IS the user's visible
  // input — a synthetic "wakeup" message would duplicate it (plan
  // 2026-06-09-005 U3).
  if (
    runThreadId &&
    shouldInsertSyntheticWakeupUserMessage({
      source: wakeup.source,
      payload,
    })
  ) {
    const userContent = agentMessage.trim();
    await insertUserMessage(runThreadId, wakeup.tenant_id, userContent);
  }

  agentMessage = await prependThreadProgressForAgentTurn(agentMessage, {
    tenantSlug,
    threadId: runThreadId,
  });

  try {
    const triggerChannel = threadContext?.channel || wakeup.source || "";

    console.log(
      `[wakeup-processor] Invoking AgentCore for agent=${wakeup.agent_id} runtime=${runtimeType} mcp=${mcpServers.join(",")} source=${wakeup.source} traceId=${traceId}`,
    );

    // Sandbox pre-flight (plan Unit 9). Wakeup-side resolves the invoking
    // user from invokerUserId first, falling back to the agent's owning
    // human_pair_id for system/agent triggers. CURRENT_USER_ID stays null
    // for R15 admin-skill-spoofing defense; this is a separate resolution
    // used only for the tenant/policy check.
    const sandboxUserId = invokerUserId ?? agent.human_pair_id ?? undefined;
    let sandboxPreflight: SandboxPreflightResult | null = null;
    if (sandboxUserId && agent.sandbox) {
      try {
        sandboxPreflight = await checkSandboxPreflight({
          stage: STAGE,
          tenantId: wakeup.tenant_id,
          agentId: wakeup.agent_id,
          userId: sandboxUserId,
          templateSandbox: agent.sandbox as TemplateSandboxConfig | null,
        });
        console.log(
          `[wakeup-processor] sandbox pre-flight: ${sandboxPreflight.status}`,
        );
      } catch (err) {
        console.error(`[wakeup-processor] sandbox pre-flight failed:`, err);
        sandboxPreflight = null;
      }
    }

    const agentCorePayload: Record<string, unknown> = {
      tenant_id: wakeup.tenant_id,
      // Unit 7 made workspace_tenant_id a hard gate in
      // _ensure_workspace_ready; missing it means the container
      // skips workspace sync and /tmp/workspace stays empty.
      workspace_tenant_id: wakeup.tenant_id,
      assistant_id: wakeup.agent_id,
      thread_id: resolvedThreadId,
      // R15: only a real human invoker. For wakeups that's the
      // actor that requested the wakeup, NOT the agent's pair.
      // System / agent actors produce no invoker — downstream
      // admin skills refuse. See feat/current-user-id-plumbing.
      user_id: invokerUserId,
      current_user_email: currentUserEmail || undefined,
      current_user_name: currentUserName || undefined,
      trace_id: traceId,
      message: agentMessage,
      use_memory: true,
      tenant_slug: tenantSlug || undefined,
      instance_id: agentSlug || undefined,
      agent_name: agent.name,
      system_prompt: agent.system_prompt || undefined,
      human_name: humanName || undefined,
      workspace_bucket: workspaceBucket() || undefined,
      workspace_prefix: workspacePrefix,
      appsync_endpoint: appsyncEndpoint() || undefined,
      appsync_api_key: getAppsyncApiKey() || undefined,
      hindsight_endpoint: hindsightEndpoint() || undefined,
      web_search_config: effectiveWebSearchConfig,
      web_extract_config: effectiveWebExtractConfig
        ? {
            toolSlug: effectiveWebExtractConfig.toolSlug,
            provider: effectiveWebExtractConfig.provider,
            apiKey: effectiveWebExtractConfig.apiKey,
            config: effectiveWebExtractConfig.config,
          }
        : undefined,
      send_email_config: effectiveSendEmailConfig
        ? { ...effectiveSendEmailConfig, threadId: resolvedThreadId }
        : undefined,
      context_engine_enabled: effectiveContextEngineEnabled || undefined,
      context_engine_config: effectiveContextEngineConfig,
      knowledge_graph_enabled: effectiveKnowledgeGraphEnabled || undefined,
      runtime_type: runtimeType,
      model: agentModel,
      skills:
        effectiveSkillsConfig.length > 0 ? effectiveSkillsConfig : undefined,
      knowledge_bases: knowledgeBasesConfig,
      guardrail_config: guardrailPayload || undefined,
      mcp_servers: mcpServers,
      mcp_base_url: MCP_BASE_URL || undefined,
      mcp_auth_secret: MCP_AUTH_SECRET || undefined,
      gateway_url: AGENTCORE_GATEWAY_URL || undefined,
      mcp_configs: mcpConfigs.length > 0 ? mcpConfigs : undefined,
      session_key: triggerId || `wakeup-${wakeup.source}`,
      trigger_channel: triggerChannel || undefined,
      blocked_tools:
        effectiveBlockedTools.length > 0 ? effectiveBlockedTools : undefined,
      browser_automation_enabled:
        effectiveBrowserAutomationEnabled || undefined,
      // Extension gate + model-governance parity with chat-agent-invoke
      // (#2395 bug class): the runtime registers ask_user_question /
      // task-status only when the payload carries the API wiring + active
      // turn id, and model routing/profile delegation need the same fields
      // the chat path ships. All dispatch-critical fields live in the shared
      // helper — never inline one here (the parity test enforces this).
      // includeFinalizeCallback stays false: this path invokes
      // RequestResponse and owns writeback from the synchronous body.
      ...buildAgentDispatchControlFields({
        thinkworkApiUrl: thinkworkApiUrl(),
        apiAuthSecret: getApiAuthSecret(),
        threadId: resolvedThreadId || undefined,
        threadTurnId: run.id,
        agentProfiles: agentProfilesConfig,
        modelRoutingPolicy,
        approvedModelIds,
        renderedWorkspacePrefix,
        turnContext: runSpaceId
          ? {
              spaceId: renderedWorkspace.activeSpace?.id ?? runSpaceId,
              tenantSlug: tenantSlug || undefined,
              spaceSlug: renderedWorkspace.activeSpace?.slug ?? runSpaceSlug,
            }
          : null,
        includeFinalizeCallback: false,
      }),
    };

    if (wakeup.source === "chat_message" && runThreadId && messageId) {
      const attachmentContext = await loadChatMessageAttachmentContext({
        tenantId: wakeup.tenant_id,
        threadId: runThreadId,
        messageId,
      });
      if (attachmentContext.messageAttachments.length > 0) {
        Object.assign(agentCorePayload, {
          message_attachments: attachmentContext.messageAttachments,
        });
      }
      if (attachmentContext.threadAttachmentManifest.length > 0) {
        Object.assign(agentCorePayload, {
          thread_attachments_manifest:
            attachmentContext.threadAttachmentManifest,
        });
      }

      // Force-pinned skills parity with the direct chat-agent-invoke path
      // (plan 2026-06-04-004 U3). The wakeup fallback re-resolves
      // `messages.metadata.skills` for the same user message and builds the
      // ephemeral `pinned_skills` branch, dropping any blocked slug (KD4) using
      // the resolved blocked_tools for this turn.
      try {
        const pinnedSlugs = filterBlockedSkills(
          await resolveDispatchPinnedSkills({
            db,
            tenantId: wakeup.tenant_id,
            threadId: runThreadId,
            messageId,
          }),
          effectiveBlockedTools,
        );
        if (pinnedSlugs.length > 0 && tenantSlug) {
          Object.assign(agentCorePayload, {
            pinned_skills: pinnedSlugs.map((slug) => ({
              skillId: slug,
              s3Key: tenantCatalogSkillS3Key(tenantSlug, slug),
            })),
          });
        }
      } catch (err) {
        console.error(
          "[wakeup-processor] Failed to resolve pinned skills:",
          err,
        );
      }
    }

    // ask_user_question answer context (plan 2026-06-09-005 U3) — both
    // resume routes deliver the same snake_case `pending_user_questions`
    // runtime field:
    //   - card route: source 'question_answer', answer fields top-level in
    //     the wakeup payload (threadId stays top-level for
    //     promoteNextDeferredWakeup).
    //   - reply route fallback: a chat_message wakeup whose payload nests
    //     `pendingQuestionAnswers` (the direct chat-agent-invoke dispatch
    //     failed, but the consume already committed — don't drop it).
    {
      const answerContext =
        wakeup.source === "question_answer"
          ? pendingQuestionAnswersFromPayload(payload)
          : pendingQuestionAnswersFromPayload(payload?.pendingQuestionAnswers);
      if (answerContext) {
        Object.assign(agentCorePayload, {
          pending_user_questions: toRuntimePendingUserQuestions(answerContext),
        });
      }
    }

    if (wakeup.source === "workspace_event" && workspacePayload) {
      Object.assign(agentCorePayload, {
        workspace_run_id: workspacePayload.workspaceRunId,
        workspace_target_path: workspacePayload.targetPath,
        workspace_source_object_key: workspacePayload.sourceObjectKey,
        workspace_event_id: workspacePayload.workspaceEventId,
        workspace_request_object_key: workspacePayload.requestObjectKey,
        cause_event_id: workspacePayload.causeEventId,
        cause_type: workspacePayload.causeType,
        workspace_depth: workspacePayload.depth,
        workspace_resume_reason: workspacePayload.resumeReason,
      });
    }

    if (sandboxPreflight && sandboxUserId) {
      applySandboxPayloadFields(agentCorePayload, sandboxPreflight);
      if (sandboxPreflight.status !== "ready") {
        console.log(
          `[wakeup-processor] sandbox not registered for this wakeup: ${sandboxPreflight.status}`,
          sandboxPreflight.status === "provisioning"
            ? { environment: sandboxPreflight.environment }
            : {},
        );
      }
    }

    const invokeResponse = await invokeAgentCore(
      agentCorePayload as any,
      runtimeType,
    );

    const durationMs = Date.now() - startMs;

    if (!invokeResponse.ok) {
      throw new Error(
        `AgentCore invoke failed: ${invokeResponse.status} ${JSON.stringify(invokeResponse.result)}`,
      );
    }

    const invokeResult = invokeResponse.result;
    const capturedSystemPrompt = extractComposedSystemPrompt(invokeResult);
    const rawResponseText = extractResponseText(
      invokeResult.response || invokeResult,
    );

    // PRD-22: Use response directly (signal protocol removed)
    const responseText = rawResponseText;

    // Extract tools_called for turn loop detection
    const toolsCalled = (invokeResult.tools_called ||
      (invokeResult.response as Record<string, unknown>)?.tools_called ||
      []) as string[];

    console.log(
      `[wakeup-processor] AgentCore response (${responseText.length} chars) in ${durationMs}ms`,
    );

    // 6. Handle response based on source type

    if (
      wakeup.source === "chat_message" ||
      wakeup.source === "automation" ||
      wakeup.source === "question_answer"
    ) {
      // Insert assistant message + notify subscribers (chat flow; the
      // question_answer resume turn replies into the same thread)
      const threadId = String(payload?.threadId || "");
      if (threadId && responseText && responseText !== "{}") {
        const assistantMsg = await insertAssistantMessage(
          threadId,
          wakeup.tenant_id,
          wakeup.agent_id,
          responseText,
        );
        if (assistantMsg) {
          await notifyNewMessage({
            messageId: assistantMsg.id,
            threadId,
            tenantId: wakeup.tenant_id,
            role: "assistant",
            content: responseText,
            senderType: "agent",
            senderId: wakeup.agent_id,
          });
        }
      }
    } else if (
      wakeup.source === "email_triage" &&
      responseText &&
      responseText !== "{}"
    ) {
      // Post triage summary to a dedicated triage thread
      const runtimeConfig =
        (agent.runtime_config as Record<string, unknown>) || {};
      const prodConfig =
        (runtimeConfig.productivityConfig as Record<string, unknown>) || {};
      let triageThreadId = prodConfig.triageChatThreadId as string | undefined;

      // Auto-create triage thread if none exists
      if (!triageThreadId) {
        try {
          const { threadId } = await ensureThreadForWork({
            tenantId: wakeup.tenant_id,
            agentId: wakeup.agent_id,
            title: `${agent.name} — Email Triage`,
            channel: "email",
          });
          triageThreadId = threadId;
          runThreadId = threadId;

          // Persist the thread ID in runtime_config so future triage runs reuse it
          await db
            .update(agents)
            .set({
              runtime_config: {
                ...runtimeConfig,
                productivityConfig: {
                  ...prodConfig,
                  triageChatThreadId: triageThreadId,
                },
              },
            })
            .where(eq(agents.id, wakeup.agent_id));

          console.log(
            `[wakeup-processor] Created triage thread ${triageThreadId} for agent ${wakeup.agent_id}`,
          );
        } catch (threadErr) {
          console.error(
            `[wakeup-processor] Failed to create triage thread:`,
            threadErr,
          );
        }
      } else {
        // Existing triage thread — use it directly
        if (!runThreadId) {
          runThreadId = triageThreadId;
        }
      }

      if (triageThreadId) {
        const assistantMsg = await insertAssistantMessage(
          triageThreadId,
          wakeup.tenant_id,
          wakeup.agent_id,
          responseText,
        );
        if (assistantMsg) {
          await notifyNewMessage({
            messageId: assistantMsg.id,
            threadId: triageThreadId,
            tenantId: wakeup.tenant_id,
            role: "assistant",
            content: responseText,
            senderType: "agent",
            senderId: wakeup.agent_id,
          });
        }
      }
    } else if (
      wakeup.source === "email_received" &&
      responseText &&
      responseText !== "{}"
    ) {
      // Route response to email thread (create or reuse based on reply token context)
      const replyTokenContextId = payload?.replyTokenContextId as
        | string
        | undefined;
      const emailSubject = (payload?.subject as string) || "(no subject)";
      let emailThreadId = replyTokenContextId || "";

      if (replyTokenContextId) {
        // replyTokenContextId now points directly to a thread (data was migrated)
        if (!runThreadId) {
          runThreadId = replyTokenContextId;
        }
      }

      // Auto-create email thread if no context from reply token
      if (!emailThreadId) {
        try {
          const { threadId } = await ensureThreadForWork({
            tenantId: wakeup.tenant_id,
            agentId: wakeup.agent_id,
            title: `Email: ${emailSubject}`,
            channel: "email",
          });
          emailThreadId = threadId;
          runThreadId = threadId;

          console.log(
            `[wakeup-processor] Created email thread ${emailThreadId} for agent ${wakeup.agent_id}`,
          );
        } catch (threadErr) {
          console.error(
            `[wakeup-processor] Failed to create email thread:`,
            threadErr,
          );
        }
      }

      if (emailThreadId) {
        // Insert the inbound email as a user message
        const fromEmail = (payload?.from as string) || "unknown";
        const emailBody = (payload?.body as string) || "";
        const inboundContent = `**From:** ${fromEmail}\n**Subject:** ${emailSubject}\n\n${emailBody}`;
        await insertAssistantMessage(
          emailThreadId,
          wakeup.tenant_id,
          wakeup.agent_id,
          inboundContent,
        );

        // Insert the agent's response
        const assistantMsg = await insertAssistantMessage(
          emailThreadId,
          wakeup.tenant_id,
          wakeup.agent_id,
          responseText,
        );
        if (assistantMsg) {
          await notifyNewMessage({
            messageId: assistantMsg.id,
            threadId: emailThreadId,
            tenantId: wakeup.tenant_id,
            role: "assistant",
            content: responseText,
            senderType: "agent",
            senderId: wakeup.agent_id,
          });
        }
      }
    } else if (
      wakeup.source === "webhook" &&
      responseText &&
      responseText !== "{}"
    ) {
      // Post webhook response to the thread
      if (runThreadId) {
        const assistantMsg = await insertAssistantMessage(
          runThreadId,
          wakeup.tenant_id,
          wakeup.agent_id,
          responseText,
        );
        if (assistantMsg) {
          await notifyNewMessage({
            messageId: assistantMsg.id,
            threadId: runThreadId,
            tenantId: wakeup.tenant_id,
            role: "assistant",
            content: responseText,
            senderType: "agent",
            senderId: wakeup.agent_id,
          });
        }
      }
    }

    // Catch-all: insert assistant message for sources that don't already do it
    // (see SOURCES_WITH_MESSAGES at module scope)
    if (
      runThreadId &&
      responseText &&
      responseText !== "{}" &&
      !SOURCES_WITH_MESSAGES.includes(wakeup.source)
    ) {
      const assistantMsg = await insertAssistantMessage(
        runThreadId,
        wakeup.tenant_id,
        wakeup.agent_id,
        responseText,
      );
      if (assistantMsg) {
        await notifyNewMessage({
          messageId: assistantMsg.id,
          threadId: runThreadId,
          tenantId: wakeup.tenant_id,
          role: "assistant",
          content: responseText,
          senderType: "agent",
          senderId: wakeup.agent_id,
        });
      }
    }

    // Link orphan artifacts created during this turn to the thread + last message
    if (runThreadId && wakeup.agent_id) {
      try {
        const lastMsg = await db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.thread_id, runThreadId),
              eq(messages.role, "assistant"),
            ),
          )
          .orderBy(desc(messages.created_at))
          .limit(1);
        if (lastMsg.length > 0) {
          const { isNull, gte } = await import("drizzle-orm");
          const turnStart = new Date(run.started_at || run.created_at);
          await db
            .update(artifacts)
            .set({
              thread_id: runThreadId,
              source_message_id: lastMsg[0].id,
            })
            .where(
              and(
                eq(artifacts.agent_id, wakeup.agent_id),
                eq(artifacts.tenant_id, wakeup.tenant_id),
                isNull(artifacts.source_message_id),
                gte(artifacts.created_at, turnStart),
              ),
            );
        }
      } catch (err) {
        console.error(
          "[wakeup-processor] Failed to link orphan artifacts:",
          err,
        );
      }
    }

    // PRD-15: If thread_id was resolved mid-flight (email branches), update the thread_turn
    if (runThreadId && !run.thread_id) {
      try {
        const [c] = await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(threadTurns)
          .where(eq(threadTurns.thread_id, runThreadId));
        await db
          .update(threadTurns)
          .set({ thread_id: runThreadId, turn_number: (c?.count || 0) + 1 })
          .where(eq(threadTurns.id, run.id));
      } catch {}
    }

    // 7. Record cost events (PRD-02)
    const usage = extractUsage(invokeResult);
    try {
      const costResult = await recordCostEvents({
        tenantId: wakeup.tenant_id,
        agentId: wakeup.agent_id,
        userId: costOwnerUserId ?? null,
        requestId: wakeup.id,
        model: usage.model || agentModel,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedReadTokens: usage.cachedReadTokens,
        durationMs,
        inputText: agentMessage,
        outputText: responseText,
        threadId: runThreadId,
        traceId,
        runtimeType,
      });
      await checkBudgetAndPause(
        wakeup.tenant_id,
        wakeup.agent_id,
        costOwnerUserId ?? null,
      );

      // Notify subscribers that cost was recorded
      if (costResult.totalUsd > 0) {
        await notifyCostRecorded({
          tenantId: wakeup.tenant_id,
          agentId: wakeup.agent_id,
          agentName: agent.name,
          userId: costOwnerUserId ?? null,
          userName: currentUserName || null,
          userEmail: currentUserEmail || null,
          eventType: "invocation",
          amountUsd: costResult.totalUsd,
          model: usage.model || agentModel,
        });
      }
    } catch (costErr) {
      console.error(`[wakeup-processor] Cost recording failed:`, costErr);
      // Non-fatal — don't fail the wakeup for cost tracking issues
    }

    // 7b. Record tool costs (Nova Act, browser sessions, etc.)
    const toolCosts = (invokeResult.tool_costs ||
      (invokeResult.response as Record<string, unknown>)?.tool_costs ||
      []) as Array<Record<string, unknown>>;
    if (toolCosts.length > 0) {
      try {
        for (const tc of toolCosts) {
          await db
            .insert(costEvents)
            .values({
              tenant_id: wakeup.tenant_id,
              agent_id: wakeup.agent_id,
              user_id: costOwnerUserId || undefined,
              thread_id: runThreadId || undefined,
              request_id: crypto.randomUUID(),
              event_type: String(tc.event_type || "tool_cost"),
              runtime_type: runtimeType,
              amount_usd: String(tc.amount_usd || "0.000000"),
              provider: String(tc.provider || "unknown"),
              duration_ms: (tc.duration_ms as number) || null,
              trace_id: traceId || undefined,
              metadata: tc.metadata || {},
            })
            .onConflictDoNothing();
        }
        console.log(
          `[wakeup-processor] Recorded ${toolCosts.length} tool cost(s)`,
        );
      } catch (err) {
        console.error(`[wakeup-processor] Tool cost recording failed:`, err);
      }
    }

    // PRD-22: Persistent turn loop — re-invoke when agent called tools (replaces signal-based continue)
    if (
      workflowConfig.turnLoop.enabled &&
      workflowConfig.turnLoop.continueOnToolUse &&
      runThreadId &&
      toolsCalled.length > 0 &&
      workflowConfig.turnLoop.maxTurns > 1
    ) {
      let loopTurn = 1;
      let loopMessage = responseText;
      let loopResponseText = responseText;
      let loopToolsCalled = toolsCalled;
      const maxTurns = workflowConfig.turnLoop.maxTurns;

      while (loopToolsCalled.length > 0 && loopTurn < maxTurns) {
        loopTurn++;
        console.log(
          `[wakeup-processor] Turn loop iteration ${loopTurn}/${maxTurns} for wakeup ${wakeup.id}`,
        );

        // Update last_activity_at to prevent false stall detection
        await db
          .update(threadTurns)
          .set({ last_activity_at: new Date() })
          .where(eq(threadTurns.id, run.id));

        // U6 (plan 2026-06-12-002): the turn-loop RE-dispatch reuses the same
        // render AND thread_turn_id, so the pre-loop projection snapshot
        // already describes this dispatch — re-recording here would be a
        // redundant UPDATE with identical inputs. The merge-semantics writer
        // preserves any `fetches` the agent appends across loop iterations.

        const loopResponse = await invokeAgentCore(
          {
            tenant_id: wakeup.tenant_id,
            workspace_tenant_id: wakeup.tenant_id,
            assistant_id: wakeup.agent_id,
            thread_id: resolvedThreadId,
            // R15: same invoker as the primary invocation above.
            user_id: invokerUserId,
            current_user_email: currentUserEmail || undefined,
            current_user_name: currentUserName || undefined,
            message: `Continue working. Previous response:\n${loopMessage.slice(0, 2000)}`,
            use_memory: true,
            tenant_slug: tenantSlug || undefined,
            instance_id: agentSlug || undefined,
            agent_name: agent.name,
            system_prompt: agent.system_prompt || undefined,
            human_name: humanName || undefined,
            workspace_bucket: workspaceBucket() || undefined,
            workspace_prefix: workspacePrefix,
            appsync_endpoint: appsyncEndpoint() || undefined,
            appsync_api_key: getAppsyncApiKey() || undefined,
            hindsight_endpoint: hindsightEndpoint() || undefined,
            web_search_config: effectiveWebSearchConfig,
            web_extract_config: effectiveWebExtractConfig
              ? {
                  toolSlug: effectiveWebExtractConfig.toolSlug,
                  provider: effectiveWebExtractConfig.provider,
                  apiKey: effectiveWebExtractConfig.apiKey,
                  config: effectiveWebExtractConfig.config,
                }
              : undefined,
            send_email_config: effectiveSendEmailConfig
              ? { ...effectiveSendEmailConfig, threadId: resolvedThreadId }
              : undefined,
            context_engine_enabled: effectiveContextEngineEnabled || undefined,
            context_engine_config: effectiveContextEngineConfig,
            knowledge_graph_enabled:
              effectiveKnowledgeGraphEnabled || undefined,
            runtime_type: runtimeType,
            model: agentModel,
            skills:
              effectiveSkillsConfig.length > 0
                ? effectiveSkillsConfig
                : undefined,
            knowledge_bases: knowledgeBasesConfig,
            guardrail_config: guardrailPayload || undefined,
            mcp_servers: mcpServers,
            mcp_base_url: MCP_BASE_URL || undefined,
            mcp_auth_secret: MCP_AUTH_SECRET || undefined,
            gateway_url: AGENTCORE_GATEWAY_URL || undefined,
            mcp_configs: mcpConfigs.length > 0 ? mcpConfigs : undefined,
            session_key: triggerId || `wakeup-${wakeup.source}`,
            trigger_channel:
              threadContext?.channel || wakeup.source || undefined,
            blocked_tools:
              effectiveBlockedTools.length > 0
                ? effectiveBlockedTools
                : undefined,
            browser_automation_enabled:
              effectiveBrowserAutomationEnabled || undefined,
            // Same dispatch-control parity as the primary wakeup payload
            // above — the re-invoked turn must not lose extension tools or
            // model governance mid-loop (#2395 bug class).
            ...buildAgentDispatchControlFields({
              thinkworkApiUrl: thinkworkApiUrl(),
              apiAuthSecret: getApiAuthSecret(),
              threadId: resolvedThreadId || undefined,
              threadTurnId: run.id,
              agentProfiles: agentProfilesConfig,
              modelRoutingPolicy,
              approvedModelIds,
              renderedWorkspacePrefix,
              turnContext: runSpaceId
                ? {
                    spaceId: renderedWorkspace.activeSpace?.id ?? runSpaceId,
                    tenantSlug: tenantSlug || undefined,
                    spaceSlug:
                      renderedWorkspace.activeSpace?.slug ?? runSpaceSlug,
                  }
                : null,
              includeFinalizeCallback: false,
            }),
          },
          runtimeType,
        );

        if (!loopResponse.ok) {
          console.error(
            `[wakeup-processor] Turn loop invoke failed on iteration ${loopTurn}: ${loopResponse.status}`,
          );
          break;
        }

        const loopResult = loopResponse.result;
        const rawLoop = extractResponseText(loopResult.response || loopResult);
        loopMessage = rawLoop;
        loopResponseText = rawLoop;
        loopToolsCalled = (loopResult.tools_called ||
          (loopResult.response as Record<string, unknown>)?.tools_called ||
          []) as string[];

        // Record cost for this loop iteration
        const loopUsage = extractUsage(loopResult);
        try {
          await recordCostEvents({
            tenantId: wakeup.tenant_id,
            agentId: wakeup.agent_id,
            userId: costOwnerUserId ?? null,
            requestId: `${wakeup.id}-loop-${loopTurn}`,
            model: loopUsage.model || agentModel,
            inputTokens: loopUsage.inputTokens,
            outputTokens: loopUsage.outputTokens,
            cachedReadTokens: loopUsage.cachedReadTokens,
            durationMs: 0,
            inputText: "",
            outputText: loopResponseText,
            threadId: runThreadId,
            traceId,
            runtimeType,
          });
        } catch {}

        // Insert loop response as assistant message for chat sources
        if (
          (wakeup.source === "chat_message" ||
            wakeup.source === "automation" ||
            wakeup.source === "question_answer") &&
          loopResponseText &&
          loopResponseText !== "{}"
        ) {
          const threadId = String(payload?.threadId || "");
          if (threadId) {
            const msg = await insertAssistantMessage(
              threadId,
              wakeup.tenant_id,
              wakeup.agent_id,
              loopResponseText,
            );
            if (msg) {
              await notifyNewMessage({
                messageId: msg.id,
                threadId,
                tenantId: wakeup.tenant_id,
                role: "assistant",
                content: loopResponseText,
                senderType: "agent",
                senderId: wakeup.agent_id,
              });
            }
          }
        }

        // Log loop event
        await insertRunEvent(
          run.id,
          wakeup.tenant_id,
          wakeup.agent_id,
          loopTurn + 2,
          "turn_loop",
          {
            iteration: loopTurn,
            toolsCalled: loopToolsCalled,
          },
        );
      }

      console.log(
        `[wakeup-processor] Turn loop completed: ${loopTurn} turns, tools in last turn: ${loopToolsCalled.length}`,
      );
    }

    // 8. Update scheduled_job_run as succeeded
    await db
      .update(threadTurns)
      .set({
        status: "succeeded",
        finished_at: new Date(),
        system_prompt: capturedSystemPrompt || undefined,
        result_json: { response: responseText.slice(0, 10000) },
        usage_json: {
          duration_ms: durationMs,
          runtime_type: runtimeType,
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          cached_read_tokens: usage.cachedReadTokens,
          tools_called: (invokeResult.tools_called ||
            (invokeResult.response as Record<string, unknown>)?.tools_called ||
            []) as string[],
          tool_costs: toolCosts.map((tc: Record<string, unknown>) => ({
            event_type: tc.event_type,
            amount_usd: tc.amount_usd,
            provider: tc.provider,
          })),
        },
      })
      .where(eq(threadTurns.id, run.id));

    await updateWorkspaceRunAfterTurn(
      workspacePayload,
      wakeup,
      run.id,
      "completed",
    );

    // Log completion event
    await insertRunEvent(
      run.id,
      wakeup.tenant_id,
      wakeup.agent_id || null,
      2,
      "completed",
      {
        duration_ms: durationMs,
        response_length: responseText.length,
      },
    );

    // Notify subscribers that run succeeded
    await notifyThreadTurnUpdate({
      runId: run.id,
      triggerId,
      tenantId: wakeup.tenant_id,
      threadId: runThreadId || null,
      agentId: wakeup.agent_id || null,
      status: "succeeded",
      triggerName,
    });

    // Stamp last_turn_completed_at + preview on thread (drives inbox sorting & list preview)
    if (runThreadId) {
      try {
        await db
          .update(threads)
          .set({
            last_turn_completed_at: new Date(),
            last_response_preview:
              responseText
                .replace(/[#*_`]/g, "")
                .trim()
                .slice(0, 200) || null,
          })
          .where(eq(threads.id, runThreadId));
      } catch (e) {
        console.error(
          "[wakeup-processor] Failed to stamp last_turn_completed_at:",
          e,
        );
      }
    }

    // Send push notification to user devices
    if (runThreadId) {
      try {
        const { sendTurnCompletedPush } =
          await import("../lib/push-notifications.js");
        await sendTurnCompletedPush({
          threadId: runThreadId,
          tenantId: wakeup.tenant_id,
          agentId: wakeup.agent_id,
          title: agent.name || "Agent",
          body: responseText.replace(/[#*_`]/g, "").trim(),
        });
      } catch (err) {
        console.error("[wakeup-processor] Push notification failed:", err);
      }
    }

    // 8. Mark wakeup as completed
    await db
      .update(agentWakeupRequests)
      .set({ status: "completed", finished_at: new Date() })
      .where(eq(agentWakeupRequests.id, wakeup.id));

    // Update agent last_heartbeat_at
    await db
      .update(agents)
      .set({ last_heartbeat_at: new Date() })
      .where(eq(agents.id, wakeup.agent_id));

    // PRD-09 Batch 4: Promote next deferred wakeup for this thread
    if (runThreadId) {
      try {
        await promoteNextDeferredWakeup(wakeup.tenant_id, runThreadId);
      } catch {}
    }
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(
      `[wakeup-processor] AgentCore invocation failed for wakeup ${wakeup.id}:`,
      errMsg,
    );

    // Update scheduled_job_run as failed
    await db
      .update(threadTurns)
      .set({
        status: "failed",
        finished_at: new Date(),
        error: errMsg,
        usage_json: { duration_ms: durationMs },
      })
      .where(eq(threadTurns.id, run.id));

    await updateWorkspaceRunAfterTurn(
      workspacePayload,
      wakeup,
      run.id,
      "failed",
    );

    // Log error event
    await insertRunEvent(
      run.id,
      wakeup.tenant_id,
      wakeup.agent_id || null,
      2,
      "error",
      {
        error: errMsg,
        duration_ms: durationMs,
      },
    );

    // Notify subscribers that run failed
    await notifyThreadTurnUpdate({
      runId: run.id,
      triggerId,
      tenantId: wakeup.tenant_id,
      threadId: runThreadId || null,
      agentId: wakeup.agent_id || null,
      status: "failed",
      triggerName,
    });

    // Stamp last_turn_completed_at on thread (drives inbox sorting)
    if (runThreadId) {
      try {
        await db
          .update(threads)
          .set({
            last_turn_completed_at: new Date(),
            last_response_preview: `Error: ${errMsg}`.slice(0, 200),
          })
          .where(eq(threads.id, runThreadId));
      } catch (e) {
        console.error(
          "[wakeup-processor] Failed to stamp last_turn_completed_at:",
          e,
        );
      }
    }

    // If this was a chat message (or a question-answer resume), insert
    // error reply so user gets feedback
    if (
      wakeup.source === "chat_message" ||
      wakeup.source === "automation" ||
      wakeup.source === "question_answer"
    ) {
      const threadId = String(
        (payload as Record<string, unknown>)?.threadId || "",
      );
      if (threadId) {
        try {
          const errReply = await insertAssistantMessage(
            threadId,
            wakeup.tenant_id,
            wakeup.agent_id,
            "I'm sorry, I encountered an error processing your request. Please try again.",
          );
          if (errReply) {
            await notifyNewMessage({
              messageId: errReply.id,
              threadId,
              tenantId: wakeup.tenant_id,
              role: "assistant",
              content:
                "I'm sorry, I encountered an error processing your request. Please try again.",
              senderType: "agent",
              senderId: wakeup.agent_id,
            });
          }
        } catch (innerErr) {
          console.error(
            `[wakeup-processor] Failed to insert error message:`,
            innerErr,
          );
        }
      }
    }

    await failWakeup(wakeup.id, errMsg);

    // PRD-09 Batch 4: Promote next deferred wakeup even on failure
    if (runThreadId) {
      try {
        await promoteNextDeferredWakeup(wakeup.tenant_id, runThreadId);
      } catch {}
    }
  }
}

async function prependThreadProgressForAgentTurn(
  agentMessage: string,
  input: { tenantSlug: string; threadId?: string },
): Promise<string> {
  if (!input.tenantSlug || !input.threadId) return agentMessage;
  try {
    const goal = await readThreadGoalFile(
      {
        tenantSlug: input.tenantSlug,
        threadId: input.threadId,
        file: "GOAL.md",
      },
      { bucket: workspaceBucket() },
    );
    if (goal?.trim()) {
      const goalFiles = await readThreadGoalPromptFiles(
        { tenantSlug: input.tenantSlug, threadId: input.threadId },
        { bucket: workspaceBucket() },
      );
      return prependThreadGoalPromptBlock(agentMessage, goalFiles);
    }

    const content = await readThreadProgressMarkdown(
      { tenantSlug: input.tenantSlug, threadId: input.threadId },
      { bucket: workspaceBucket() },
    );
    if (!content) return agentMessage;
    return prependThreadProgressPromptBlock(agentMessage, content);
  } catch (error) {
    console.warn("[wakeup-processor] Failed to load thread PROGRESS.md", {
      tenantSlug: input.tenantSlug,
      threadId: input.threadId,
      error,
    });
    return agentMessage;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function failWakeup(wakeupId: string, error: string): Promise<void> {
  await db
    .update(agentWakeupRequests)
    .set({ status: "failed", finished_at: new Date() })
    .where(eq(agentWakeupRequests.id, wakeupId));
}

async function failWakeupBeforeRun(input: {
  wakeup: WakeupRow;
  payload: Record<string, unknown> | null;
  error: string;
  runtimeType: AgentRuntimeType;
  model: string | null;
}): Promise<void> {
  const now = new Date();
  const threadId = String(input.payload?.threadId || "") || undefined;
  let runId: string | null = null;

  if (threadId) {
    let turnNumber: number | undefined;
    try {
      const [countRow] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(threadTurns)
        .where(eq(threadTurns.thread_id, threadId));
      turnNumber = (countRow?.count || 0) + 1;
    } catch {}

    const [run] = await db
      .insert(threadTurns)
      .values({
        tenant_id: input.wakeup.tenant_id,
        agent_id: input.wakeup.agent_id,
        wakeup_request_id: input.wakeup.id,
        invocation_source: input.wakeup.source,
        trigger_detail: input.wakeup.trigger_detail,
        runtime_type: input.runtimeType,
        status: "failed",
        started_at: now,
        finished_at: now,
        error: input.error,
        thread_id: threadId,
        turn_number: turnNumber,
        context_snapshot: {
          ...(input.payload ?? {}),
          runtime_type: input.runtimeType,
          model: input.model,
        },
      })
      .returning({ id: threadTurns.id });
    runId = run?.id ?? null;

    await db
      .update(threads)
      .set({
        last_turn_completed_at: now,
        last_response_preview: `Error: ${input.error}`.slice(0, 200),
      })
      .where(eq(threads.id, threadId));

    if (runId) {
      await notifyThreadTurnUpdate({
        runId,
        triggerId: null,
        tenantId: input.wakeup.tenant_id,
        threadId,
        agentId: input.wakeup.agent_id,
        status: "failed",
        triggerName: null,
      });
    }

    if (input.wakeup.source === "chat_message") {
      const content =
        "This agent is paused because its budget has been exceeded. Ask an operator to unpause it, then try again.";
      try {
        const errReply = await insertAssistantMessage(
          threadId,
          input.wakeup.tenant_id,
          input.wakeup.agent_id,
          content,
        );
        if (errReply) {
          await notifyNewMessage({
            messageId: errReply.id,
            threadId,
            tenantId: input.wakeup.tenant_id,
            role: "assistant",
            content,
            senderType: "agent",
            senderId: input.wakeup.agent_id,
          });
        }
      } catch (err) {
        console.error(
          `[wakeup-processor] Failed to insert pre-run failure message:`,
          err,
        );
      }
    }
  }

  await db
    .update(agentWakeupRequests)
    .set({ status: "failed", finished_at: now, run_id: runId ?? undefined })
    .where(eq(agentWakeupRequests.id, input.wakeup.id));
}

async function updateWorkspaceRunAfterTurn(
  workspacePayload: NormalizedWorkspaceWakeupPayload | null,
  wakeup: WakeupRow,
  threadTurnId: string,
  status: "completed" | "failed",
): Promise<void> {
  if (!workspacePayload?.workspaceRunId) return;
  const finishedAt = new Date();
  await db
    .update(agentWorkspaceRuns)
    .set({
      status,
      completed_at: finishedAt,
      last_event_at: finishedAt,
      updated_at: finishedAt,
    })
    .where(
      and(
        eq(agentWorkspaceRuns.id, workspacePayload.workspaceRunId),
        eq(agentWorkspaceRuns.tenant_id, wakeup.tenant_id),
        eq(agentWorkspaceRuns.agent_id, wakeup.agent_id),
        eq(agentWorkspaceRuns.current_wakeup_request_id, wakeup.id),
        eq(agentWorkspaceRuns.current_thread_turn_id, threadTurnId),
        inArray(agentWorkspaceRuns.status, [
          ...WORKSPACE_TURN_IN_FLIGHT_STATUSES,
        ]),
      ),
    );
}

async function insertRunEvent(
  runId: string,
  tenantId: string,
  agentId: string | null,
  seq: number,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(threadTurnEvents).values({
      run_id: runId,
      tenant_id: tenantId,
      agent_id: agentId,
      seq,
      event_type: eventType,
      stream: "system",
      level: eventType === "error" ? "error" : "info",
      message: eventType,
      payload,
    });
  } catch (err) {
    console.error(`[wakeup-processor] Failed to insert run event:`, err);
  }
}

function extractResponseText(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return String(data);

  const obj = data as Record<string, unknown>;

  // OpenAI ChatCompletion format
  if (
    Array.isArray(obj.choices) &&
    (obj.choices[0] as Record<string, unknown>)?.message
  ) {
    return String(
      (
        (obj.choices as Record<string, unknown>[])[0].message as Record<
          string,
          unknown
        >
      )?.content || "",
    );
  }

  if (typeof obj.content === "string") return obj.content;
  if (typeof obj.response === "string") return obj.response;
  if (typeof obj.output === "string") return obj.output;
  if (typeof obj.text === "string") return obj.text;

  if (obj.response && typeof obj.response === "object") {
    return extractResponseText(obj.response);
  }

  return JSON.stringify(data);
}

async function insertAssistantMessage(
  threadId: string,
  tenantId: string,
  agentId: string,
  content: string,
): Promise<{ id: string } | null> {
  try {
    const [row] = await db
      .insert(messages)
      .values({
        thread_id: threadId,
        tenant_id: tenantId,
        role: "assistant",
        content,
        sender_type: "agent",
        sender_id: agentId,
      })
      .returning({ id: messages.id });
    console.log(`[wakeup-processor] Inserted assistant message: ${row.id}`);
    return row;
  } catch (err) {
    console.error(
      `[wakeup-processor] Failed to insert assistant message:`,
      err,
    );
    return null;
  }
}

async function insertUserMessage(
  threadId: string,
  tenantId: string,
  content: string,
): Promise<{ id: string } | null> {
  try {
    const [row] = await db
      .insert(messages)
      .values({
        thread_id: threadId,
        tenant_id: tenantId,
        role: "user",
        content,
        sender_type: "system",
      })
      .returning({ id: messages.id });
    console.log(`[wakeup-processor] Inserted user message: ${row.id}`);
    return row;
  } catch (err) {
    console.error(`[wakeup-processor] Failed to insert user message:`, err);
    return null;
  }
}

async function notifyThreadTurnUpdate(payload: {
  runId: string;
  triggerId: string | null;
  tenantId: string;
  threadId: string | null;
  agentId: string | null;
  status: string;
  triggerName: string | null;
}): Promise<void> {
  const appsyncApiKey = getAppsyncApiKey();
  if (!appsyncEndpoint() || !appsyncApiKey) return;

  const mutation = `
		mutation NotifyThreadTurnUpdate(
			$runId: ID!
			$triggerId: ID
			$tenantId: ID!
			$threadId: ID
			$agentId: ID
			$status: String!
			$triggerName: String
		) {
			notifyThreadTurnUpdate(
				runId: $runId
				triggerId: $triggerId
				tenantId: $tenantId
				threadId: $threadId
				agentId: $agentId
				status: $status
				triggerName: $triggerName
			) {
				runId
				triggerId
				tenantId
				threadId
				agentId
				status
				triggerName
				updatedAt
			}
		}
	`;

  try {
    const response = await fetch(appsyncEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": appsyncApiKey,
      },
      body: JSON.stringify({ query: mutation, variables: payload }),
    });
    const responseBody = await response.text();
    if (!response.ok || responseBody.includes('"errors"')) {
      console.error(
        `[wakeup-processor] AppSync notifyThreadTurnUpdate issue: ${response.status} ${responseBody}`,
      );
    }
  } catch (err) {
    console.error(
      `[wakeup-processor] AppSync notifyThreadTurnUpdate error:`,
      err,
    );
  }
}

async function notifyNewMessage(payload: {
  messageId: string;
  threadId: string;
  tenantId: string;
  role: string;
  content: string;
  senderType: string;
  senderId: string;
}): Promise<void> {
  const appsyncApiKey = getAppsyncApiKey();
  if (!appsyncEndpoint() || !appsyncApiKey) {
    console.warn(
      `[wakeup-processor] AppSync not configured, skipping notification`,
    );
    return;
  }

  const mutation = `
		mutation NotifyNewMessage(
			$messageId: ID!
			$threadId: ID!
			$tenantId: ID!
			$role: String!
			$content: String!
			$senderType: String
			$senderId: ID
			$ownerType: String
			$ownerId: ID
		) {
			notifyNewMessage(
				messageId: $messageId
				threadId: $threadId
				tenantId: $tenantId
				role: $role
				content: $content
				senderType: $senderType
				senderId: $senderId
				ownerType: $ownerType
				ownerId: $ownerId
			) {
				messageId
				threadId
				tenantId
				role
				content
				senderType
				senderId
				ownerType
				ownerId
				createdAt
			}
		}
	`;

  try {
    const response = await fetch(appsyncEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": appsyncApiKey,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          ...payload,
          ownerType:
            payload.senderType === "assistant" ? "agent" : payload.senderType,
          ownerId: payload.senderId,
        },
      }),
    });
    const responseBody = await response.text();
    if (!response.ok || responseBody.includes('"errors"')) {
      console.error(
        `[wakeup-processor] AppSync notify issue: ${response.status} ${responseBody}`,
      );
    }
  } catch (err) {
    console.error(`[wakeup-processor] AppSync notify error:`, err);
  }
}
