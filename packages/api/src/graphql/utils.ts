/**
 * Shared utilities for GraphQL resolvers.
 *
 * Extracted from the monolithic graphql-resolver.ts to be shared across
 * the resolver modules (queries.ts, mutations.ts, types.ts).
 */

import { createHash, randomUUID, randomBytes } from "node:crypto";
import {
  eq,
  ne,
  and,
  or,
  isNull,
  asc,
  desc,
  lt,
  gt,
  gte,
  lte,
  isNotNull,
  sql,
  inArray,
  notInArray,
} from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  // Core
  tenants,
  tenantMembers,
  tenantSettings,
  users,
  userProfiles,
  // Agents
  agents,
  agentCapabilities,
  agentSkills,
  modelCatalog,
  // Messages
  messages,
  messageArtifacts,
  // Teams
  teams,
  teamAgents,
  teamUsers,
  // Routines
  routines,
  // Wakeup queue
  agentWakeupRequests,
  // Workspace orchestration
  agentWorkspaceEvents,
  agentWorkspaceRuns,
  agentWorkspaceWaits,
  // Scheduled Jobs (unified)
  scheduledJobs,
  threadTurns,
  threadTurnEvents,
  // Threads
  threads,
  threadLabels,
  threadAttachments,
  threadLabelAssignments,
  // Inbox Items
  inboxItems,
  inboxItemComments,
  inboxItemLinks,
  // Usage / Activity
  activityLog,
  // Agent API Keys
  agentApiKeys,
  // Cost Management (PRD-02)
  costEvents,
  budgetPolicies,
  // Knowledge Bases (PRD-13)
  knowledgeBases,
  agentKnowledgeBases,
  // Thread Dependencies (PRD-09)
  threadDependencies,
  // Artifacts
  artifacts,
  // Webhooks (PRD-19)
  webhooks,
  webhookIdempotency,
  // Quick Actions
  userQuickActions,
  // Recipes (PRD-26)
  recipes,
  // Agent Templates
  agentTemplates,
  agentVersions,
  computers,
  computerTasks,
  computerEvents,
  computerSnapshots,
  tenantRunbookCatalog,
  computerRunbookRuns,
  computerRunbookTasks,
  // Skill Runs (composable-skills Unit 4)
  skillRuns,
  // Mutation idempotency (thinkwork-admin plan Unit 4)
  mutationIdempotency,
  // Sandbox (AgentCore Code Sandbox plan)
  tenantPolicyEvents,
  sandboxInvocations,
  // Resolved Capability Manifest (plan §U15)
  resolvedCapabilityManifests,
  tenantMcpContextTools,
  tenantCredentials,
  // Customize page (apps/computer)
  skillCatalog,
  tenantSkills,
  tenantWorkflowCatalog,
  slackWorkspaces,
  slackUserLinks,
} from "@thinkwork/database-pg/schema";
import { checkAndFireUnblockWakeups } from "../lib/orchestration/thread-release.js";
import { generateSlug } from "@thinkwork/database-pg/utils/generate-slug";
import {
  normalizeAgentRuntimeType,
  type AgentRuntimeType,
} from "../lib/resolve-runtime-function-name.js";

// Re-export everything resolvers need
export {
  eq,
  ne,
  and,
  or,
  isNull,
  asc,
  desc,
  lt,
  gt,
  gte,
  lte,
  isNotNull,
  sql,
  inArray,
  notInArray,
  randomUUID,
  randomBytes,
  tenants,
  tenantMembers,
  tenantSettings,
  users,
  userProfiles,
  agents,
  agentCapabilities,
  agentSkills,
  modelCatalog,
  messages,
  messageArtifacts,
  teams,
  teamAgents,
  teamUsers,
  routines,
  agentWakeupRequests,
  agentWorkspaceEvents,
  agentWorkspaceRuns,
  agentWorkspaceWaits,
  scheduledJobs,
  threadTurns,
  threadTurnEvents,
  threads,
  threadLabels,
  threadAttachments,
  threadLabelAssignments,
  inboxItems,
  inboxItemComments,
  inboxItemLinks,
  activityLog,
  agentApiKeys,
  costEvents,
  budgetPolicies,
  knowledgeBases,
  agentKnowledgeBases,
  threadDependencies,
  artifacts,
  webhooks,
  webhookIdempotency,
  userQuickActions,
  recipes,
  agentTemplates,
  agentVersions,
  computers,
  computerTasks,
  computerEvents,
  computerSnapshots,
  tenantRunbookCatalog,
  computerRunbookRuns,
  computerRunbookTasks,
  skillRuns,
  mutationIdempotency,
  tenantPolicyEvents,
  sandboxInvocations,
  resolvedCapabilityManifests,
  tenantMcpContextTools,
  tenantCredentials,
  skillCatalog,
  tenantSkills,
  tenantWorkflowCatalog,
  slackWorkspaces,
  slackUserLinks,
  checkAndFireUnblockWakeups,
  generateSlug,
};

export {
  COMPLIANCE_TIERS,
  SANDBOX_ENVIRONMENTS,
  type ComplianceTier,
  type SandboxEnvironment,
} from "@thinkwork/database-pg/schema";

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export const db = getDb();

// ---------------------------------------------------------------------------
// Chat Agent Invoke — resolved from SSM at cold start
// ---------------------------------------------------------------------------

let _chatAgentInvokeFnArn: string | null | undefined;
export async function getChatAgentInvokeFnArn(): Promise<string | null> {
  if (_chatAgentInvokeFnArn !== undefined) return _chatAgentInvokeFnArn;

  // Preferred: read the ARN from env (Terraform wires it in directly).
  // Falls back to SSM lookup only for deployments that haven't been
  // migrated to the env-var path yet.
  const envArn = process.env.CHAT_AGENT_INVOKE_FN_ARN;
  if (envArn) {
    _chatAgentInvokeFnArn = envArn;
    return _chatAgentInvokeFnArn;
  }

  try {
    let stage = process.env.STAGE || "";
    if (!stage && process.env.SST_RESOURCE_App) {
      try {
        stage = JSON.parse(process.env.SST_RESOURCE_App).stage;
      } catch {}
    }
    if (!stage) stage = "dev";
    const { SSMClient, GetParameterCommand } =
      await import("@aws-sdk/client-ssm");
    const ssm = new SSMClient({});
    const res = await ssm.send(
      new GetParameterCommand({
        Name: `/thinkwork/${stage}/chat-agent-invoke-fn-arn`,
      }),
    );
    _chatAgentInvokeFnArn = res.Parameter?.Value || null;
  } catch (err) {
    console.warn(
      `[graphql] chat-agent-invoke SSM lookup failed: ${(err as Error)?.name}: ${(err as Error)?.message}`,
    );
    _chatAgentInvokeFnArn = null;
  }
  return _chatAgentInvokeFnArn;
}

// ---------------------------------------------------------------------------
// KB Manager Lambda — resolved from SSM at cold start
// ---------------------------------------------------------------------------

let _kbManagerFnArn: string | null | undefined;
export async function getKbManagerFnArn(): Promise<string | null> {
  if (_kbManagerFnArn !== undefined) return _kbManagerFnArn;
  try {
    let stage = process.env.STAGE || process.env.STAGE || "";
    if (!stage && process.env.SST_RESOURCE_App) {
      try {
        stage = JSON.parse(process.env.SST_RESOURCE_App).stage;
      } catch {}
    }
    if (!stage) stage = "dev";
    const { SSMClient, GetParameterCommand } =
      await import("@aws-sdk/client-ssm");
    const ssm = new SSMClient({});
    const res = await ssm.send(
      new GetParameterCommand({
        Name: `/thinkwork/${stage}/kb-manager-fn-arn`,
      }),
    );
    _kbManagerFnArn = res.Parameter?.Value || null;
  } catch {
    _kbManagerFnArn = null;
  }
  return _kbManagerFnArn;
}

// ---------------------------------------------------------------------------
// Eval Runner Lambda — resolved from SSM at cold start
// ---------------------------------------------------------------------------

export interface ChatAgentInvokeAttachment {
  attachmentId: string;
  s3Key: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

/** Fire-and-forget: invoke chat-agent-invoke Lambda for immediate agent response */
export async function invokeChatAgent(payload: {
  threadId: string;
  tenantId: string;
  agentId: string;
  userMessage: string;
  messageId: string;
  computerId?: string;
  computerTaskId?: string;
  runbookContext?: unknown;
  /**
   * U3 of the finance pilot — the attachment records the dispatching
   * caller resolved from `messages.metadata.attachments`. Empty array
   * when the turn has no attachments. chat-agent-invoke forwards this
   * to the AgentCore Lambda invoke payload as `message_attachments`
   * (snake_case for the Python side).
   */
  messageAttachments?: ChatAgentInvokeAttachment[];
}): Promise<boolean> {
  try {
    const fnArn = await getChatAgentInvokeFnArn();
    if (!fnArn) {
      console.warn(
        "[graphql] Chat agent invoke ARN not found, falling back to wakeup queue",
      );
      return false;
    }
    const { LambdaClient, InvokeCommand } =
      await import("@aws-sdk/client-lambda");
    const lambda = new LambdaClient({});
    await lambda.send(
      new InvokeCommand({
        FunctionName: fnArn,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );
    console.log(
      `[sendMessage] Direct chat-agent-invoke fired for thread=${payload.threadId}`,
    );
    return true;
  } catch (err) {
    console.error("[sendMessage] Failed to invoke chat-agent-invoke:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Job Schedule Manager — resolved from SSM at cold start
// ---------------------------------------------------------------------------

let _jobScheduleManagerFnArn: string | null | undefined;
export async function getJobScheduleManagerFnArn(): Promise<string | null> {
  if (_jobScheduleManagerFnArn !== undefined) return _jobScheduleManagerFnArn;
  try {
    let stage = process.env.STAGE || process.env.STAGE || "";
    if (!stage && process.env.SST_RESOURCE_App) {
      try {
        stage = JSON.parse(process.env.SST_RESOURCE_App).stage;
      } catch {}
    }
    if (!stage) stage = "dev";
    const { SSMClient, GetParameterCommand } =
      await import("@aws-sdk/client-ssm");
    const ssm = new SSMClient({});
    const res = await ssm.send(
      new GetParameterCommand({
        Name: `/thinkwork/${stage}/job-schedule-manager-fn-arn`,
      }),
    );
    _jobScheduleManagerFnArn = res.Parameter?.Value || null;
  } catch {
    _jobScheduleManagerFnArn = null;
  }
  return _jobScheduleManagerFnArn;
}

export type ScheduleManagerResult = { ok: true } | { ok: false; error: string };

/** Synchronously invoke the job schedule manager Lambda and parse the result. */
export async function invokeJobScheduleManager(
  method: string,
  body: Record<string, unknown>,
): Promise<ScheduleManagerResult> {
  try {
    const fnArn = await getJobScheduleManagerFnArn();
    if (!fnArn) {
      const msg =
        "Job schedule manager Lambda ARN not configured (SSM parameter missing)";
      console.error("[graphql]", msg);
      return { ok: false, error: msg };
    }
    const { LambdaClient, InvokeCommand } =
      await import("@aws-sdk/client-lambda");
    const lambda = new LambdaClient({});
    const res = await lambda.send(
      new InvokeCommand({
        FunctionName: fnArn,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(
          JSON.stringify({
            body: JSON.stringify(body),
            requestContext: { http: { method } },
            rawPath: "/api/job-schedules",
            headers: {
              authorization: `Bearer ${process.env.API_AUTH_SECRET || ""}`,
            },
          }),
        ),
      }),
    );
    const rawPayload = res.Payload ? new TextDecoder().decode(res.Payload) : "";
    if (res.FunctionError) {
      console.error(
        "[graphql] Job schedule manager Lambda error:",
        res.FunctionError,
        rawPayload,
      );
      return {
        ok: false,
        error: `Job schedule manager threw: ${rawPayload || res.FunctionError}`,
      };
    }
    if (rawPayload) {
      try {
        const parsed = JSON.parse(rawPayload) as {
          statusCode?: number;
          body?: string;
        };
        if (typeof parsed.statusCode === "number" && parsed.statusCode >= 400) {
          const inner =
            typeof parsed.body === "string"
              ? parsed.body
              : JSON.stringify(parsed.body);
          console.error(
            "[graphql] Job schedule manager returned",
            parsed.statusCode,
            inner,
          );
          return {
            ok: false,
            error: `Job schedule manager returned ${parsed.statusCode}: ${inner}`,
          };
        }
      } catch {
        // Non-JSON response — treat as opaque success since no FunctionError was set
      }
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[graphql] Failed to invoke job schedule manager:", err);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Skill-run invoke — agentcore-invoke Lambda with a synthetic run envelope
// ---------------------------------------------------------------------------
//
// The unified skill dispatcher lives inside the AgentCore container and
// responds to a `{kind: "run_skill", skillId, runId, ...}` envelope. The
// agentcore-invoke Lambda routes this envelope to the container in the same
// shape chat turns take today (it's just a different request body).
//
// RequestResponse invocation per auto-memory feedback_avoid_fire_and_forget_lambda_invokes:
// user-driven create MUST surface errors. The caller inspects `ok` and
// either transitions the skill_runs row out of `running` or returns the
// error to the client.

const _skillRunInvokeFnName: Partial<Record<AgentRuntimeType, string | null>> =
  {};
async function getSkillRunInvokeFnName(
  runtimeType: AgentRuntimeType,
): Promise<string | null> {
  if (_skillRunInvokeFnName[runtimeType] !== undefined) {
    return _skillRunInvokeFnName[runtimeType] ?? null;
  }
  if (runtimeType === "flue") {
    _skillRunInvokeFnName.flue =
      process.env.AGENTCORE_FLUE_FUNCTION_NAME || null;
    return _skillRunInvokeFnName.flue;
  }
  // Reuse the same Lambda as chat invocation — there's exactly one
  // agentcore-invoke Lambda, it just handles multiple envelope kinds.
  const envName = process.env.AGENTCORE_FUNCTION_NAME;
  if (envName) {
    _skillRunInvokeFnName.strands = envName;
    return _skillRunInvokeFnName.strands;
  }
  try {
    let stage = process.env.STAGE || "";
    if (!stage && process.env.SST_RESOURCE_App) {
      try {
        stage = JSON.parse(process.env.SST_RESOURCE_App).stage;
      } catch {}
    }
    if (!stage) stage = "dev";
    const { SSMClient, GetParameterCommand } =
      await import("@aws-sdk/client-ssm");
    const ssm = new SSMClient({});
    const res = await ssm.send(
      new GetParameterCommand({
        Name: `/thinkwork/${stage}/agentcore-invoke-fn-name`,
      }),
    );
    _skillRunInvokeFnName.strands = res.Parameter?.Value || null;
  } catch (err) {
    console.warn(
      `[graphql] skill-run invoke SSM lookup failed: ${(err as Error)?.name}: ${(err as Error)?.message}`,
    );
    _skillRunInvokeFnName.strands = null;
  }
  return _skillRunInvokeFnName.strands ?? null;
}

async function resolveSkillRunRuntimeType(
  tenantId: string,
  agentId: string | null,
): Promise<AgentRuntimeType> {
  if (!agentId) return "strands";
  const db = getDb();
  const [row] = await db
    .select({
      runtime: agents.runtime,
      templateRuntime: agentTemplates.runtime,
    })
    .from(agents)
    .leftJoin(agentTemplates, eq(agents.template_id, agentTemplates.id))
    .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)));
  return normalizeAgentRuntimeType(row?.runtime ?? row?.templateRuntime);
}

export type SkillRunInvokePayload = {
  kind: "run_skill";
  runId: string;
  tenantId: string;
  // Agent whose runtime config (template, skills, MCP, memory, guardrail)
  // the dispatcher fetches to build the synthetic chat turn. Required in
  // practice — a null/empty agentId causes the Python dispatcher to reject
  // the envelope with _MISSING_AGENT_REASON. Callers that don't know the
  // agent should not have inserted a skill_runs row to begin with.
  agentId: string | null;
  invokerUserId: string;
  skillId: string;
  skillVersion: number;
  invocationSource: string;
  resolvedInputs: Record<string, unknown>;
  // snake_case — the container's dispatch path reads
  // tenant_id/user_id/skill_id/subject_entity_id. Every pre-hardening
  // camelCase emit silently coerced to "" on the Python side; the bug
  // hid because no context-mode sub-skill had landed yet. See change 4
  // of docs/plans/2026-04-22-005-....
  scope?: {
    tenant_id: string;
    user_id?: string;
    skill_id: string;
    subject_entity_id?: string;
  };
  // Per-run HMAC secret the container uses to sign its
  // /api/skills/complete callback — see skill_runs.completion_hmac_secret.
  completionHmacSecret: string;
};

export type SkillRunInvokeResult = { ok: true } | { ok: false; error: string };

/**
 * Invoke the unified skill dispatcher inside the AgentCore container.
 *
 * Asynchronous (InvocationType: Event) per plan §U4. The AgentCore
 * Lambda's ceiling is 900s and the real agent loop regularly takes
 * 10-60s; RequestResponse with the 28s graphql-http socket timeout
 * would falsely time out while the work ran to completion server-side.
 * The authoritative execution-result signal is the HMAC-signed
 * /api/skills/complete callback that the container POSTs, so the
 * RequestResponse sync-error channel isn't load-bearing for this path.
 * Enqueue-level errors (IAM, Lambda not found) still surface: AWS
 * returns 4xx/5xx on Invoke itself, which we re-expose via the
 * ok/error return. `feedback_avoid_fire_and_forget_lambda_invokes`
 * does not apply — that rule governs paths with no callback; we have
 * a durable one.
 */
export async function invokeSkillRun(
  payload: SkillRunInvokePayload,
): Promise<SkillRunInvokeResult> {
  try {
    const runtimeType = await resolveSkillRunRuntimeType(
      payload.tenantId,
      payload.agentId,
    );
    const fnName = await getSkillRunInvokeFnName(runtimeType);
    if (!fnName) {
      return {
        ok: false,
        error: `${runtimeType} agentcore-invoke Lambda name not configured`,
      };
    }
    const { LambdaClient, InvokeCommand } =
      await import("@aws-sdk/client-lambda");
    const lambda = new LambdaClient({});
    const body = JSON.stringify(payload);
    const lambdaPayload = JSON.stringify({
      requestContext: { http: { method: "POST", path: "/invocations" } },
      rawPath: "/invocations",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.THINKWORK_API_SECRET || process.env.API_AUTH_SECRET || ""}`,
      },
      body,
      isBase64Encoded: false,
    });
    const res = await lambda.send(
      new InvokeCommand({
        FunctionName: fnName,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(lambdaPayload),
      }),
    );
    // Event-type invoke returns 202 on successful enqueue and 4xx/5xx
    // on enqueue failure. FunctionError + Payload only populate on
    // RequestResponse, so we only need StatusCode here.
    if (typeof res.StatusCode === "number" && res.StatusCode >= 400) {
      return {
        ok: false,
        error: `skill-run Event invoke returned ${res.StatusCode}`,
      };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[graphql] Failed to invoke skill run:", err);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// resolved_inputs canonical hash — backs skill_runs dedup
// ---------------------------------------------------------------------------
//
// Canonicalization: recursively sort object keys before stringifying so
// `{a:1,b:2}` and `{b:2,a:1}` produce the same hash. Arrays keep order;
// the semantic meaning of ordered inputs (e.g., a list of focuses) is
// preserved so `[a,b]` != `[b,a]`.

export function canonicalizeForHash(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeForHash(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalizeForHash(obj[k])}`,
  );
  return `{${entries.join(",")}}`;
}

export function hashResolvedInputs(
  resolvedInputs: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(canonicalizeForHash(resolvedInputs))
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Thread status transition map
// ---------------------------------------------------------------------------

export const VALID_TRANSITIONS: Record<string, string[]> = {
  backlog: ["todo", "in_progress", "cancelled"],
  todo: ["in_progress", "done", "backlog", "cancelled"],
  in_progress: ["todo", "in_review", "blocked", "done", "cancelled"],
  in_review: ["in_progress", "done", "cancelled"],
  blocked: ["in_progress", "todo", "cancelled"],
  done: ["in_progress"],
  cancelled: ["backlog", "todo"],
};

export function assertTransition(from: string, to: string): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid status transition: ${from} → ${to}`);
  }
}

// ---------------------------------------------------------------------------
// Inbox item status transition map
// ---------------------------------------------------------------------------

export const INBOX_ITEM_TRANSITIONS: Record<string, string[]> = {
  pending: ["approved", "rejected", "revision_requested", "cancelled"],
  revision_requested: ["pending", "cancelled"],
};

export function assertInboxItemTransition(from: string, to: string): void {
  const allowed = INBOX_ITEM_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid inbox item transition: ${from} → ${to}`);
  }
}

export async function recordActivity(
  tenantId: string,
  actorType: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  changes?: Record<string, unknown>,
): Promise<void> {
  await db.insert(activityLog).values({
    tenant_id: tenantId,
    actor_type: actorType,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    changes: changes ?? null,
  });
}

// ---------------------------------------------------------------------------
// Helpers: snake_case DB rows → camelCase GraphQL fields
// ---------------------------------------------------------------------------

const ENUM_FIELDS = new Set(["status", "channel"]);

export function snakeToCamel(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (value instanceof Date) {
      result[camelKey] = value.toISOString();
    } else if (typeof value === "object" && value !== null) {
      // Both objects and arrays get JSON.stringify'd for AWSJSON scalar fields
      result[camelKey] = JSON.stringify(value);
    } else {
      result[camelKey] = value;
    }
  }
  return result;
}

export function threadToCamel(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result = snakeToCamel(obj);
  for (const field of ENUM_FIELDS) {
    if (typeof result[field] === "string") {
      result[field] = (result[field] as string).toUpperCase();
    }
  }
  return result;
}

export function agentToCamel(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result = snakeToCamel(obj);
  for (const field of ["status", "type", "runtime"]) {
    if (typeof result[field] === "string") {
      result[field] = (result[field] as string).toUpperCase();
    }
  }
  return result;
}

export function templateToCamel(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result = snakeToCamel(obj);
  if (typeof result.templateKind === "string") {
    result.templateKind = (result.templateKind as string).toUpperCase();
  }
  if (typeof result.runtime === "string") {
    result.runtime = (result.runtime as string).toUpperCase();
  }
  return result;
}

export function computerToCamel(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result = snakeToCamel(obj);
  for (const field of ["status", "desiredRuntimeStatus", "runtimeStatus"]) {
    if (typeof result[field] === "string") {
      result[field] = (result[field] as string).toUpperCase();
    }
  }
  return result;
}

export function messageToCamel(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result = snakeToCamel(obj);
  if (typeof result.role === "string") {
    result.role = (result.role as string).toUpperCase();
  }
  return result;
}

export function artifactToCamel(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result = snakeToCamel(obj);
  for (const field of ["type", "status"]) {
    if (typeof result[field] === "string") {
      result[field] = (result[field] as string).toUpperCase();
    }
  }
  return result;
}

export function recipeToCamel(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  return snakeToCamel(obj);
}

export function inboxItemToCamel(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result = snakeToCamel(obj);
  if (typeof result.status === "string") {
    result.status = (result.status as string).toUpperCase();
  }
  if (!result.comments) result.comments = [];
  if (!result.links) result.links = [];
  if (!result.linkedThreads) result.linkedThreads = [];
  return result;
}

export function apiKeyToCamel(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result = snakeToCamel(obj);
  if (typeof result.keyHash === "string") {
    result.keyPrefix = (result.keyHash as string).slice(0, 8) + "...";
    delete result.keyHash;
  }
  return result;
}

const WORKFLOW_JSONB_FIELDS = new Set([
  "dispatch",
  "concurrency",
  "retry",
  "turnLoop",
  "workspace",
  "stallDetection",
  "orchestration",
  "sessionCompaction",
]);

export function workflowConfigToCamel(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const camel = snakeToCamel(row);
  for (const field of WORKFLOW_JSONB_FIELDS) {
    if (typeof camel[field] === "string") {
      try {
        camel[field] = JSON.parse(camel[field] as string);
      } catch {}
    }
  }
  if (typeof camel.createdAt === "string" && !camel.createdAt.includes("T")) {
    camel.createdAt = new Date(camel.createdAt + "Z").toISOString();
  }
  if (typeof camel.updatedAt === "string" && !camel.updatedAt.includes("T")) {
    camel.updatedAt = new Date(camel.updatedAt + "Z").toISOString();
  }
  return camel;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function startOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
