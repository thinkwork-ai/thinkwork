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
  sql,
  inArray,
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
  // Scheduled Jobs (unified)
  scheduledJobs,
  threadTurns,
  threadTurnEvents,
  // Threads
  threads,
  threadComments,
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
  // Skill Runs (composable-skills Unit 4)
  skillRuns,
  // Mutation idempotency (thinkwork-admin plan Unit 4)
  mutationIdempotency,
} from "@thinkwork/database-pg/schema";
import { checkAndFireUnblockWakeups } from "../lib/orchestration/thread-release.js";
import { generateSlug } from "@thinkwork/database-pg/utils/generate-slug";

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
  sql,
  inArray,
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
  scheduledJobs,
  threadTurns,
  threadTurnEvents,
  threads,
  threadComments,
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
  skillRuns,
  mutationIdempotency,
  checkAndFireUnblockWakeups,
  generateSlug,
};

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

/** Fire-and-forget: invoke chat-agent-invoke Lambda for immediate agent response */
export async function invokeChatAgent(payload: {
  threadId: string;
  tenantId: string;
  agentId: string;
  userMessage: string;
  messageId: string;
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
// Composition invoke — agentcore-invoke Lambda with a synthetic run envelope
// ---------------------------------------------------------------------------
//
// The composition runner lives inside the AgentCore container and responds
// to a new kind of envelope `{kind: "run_skill", skillId, runId, ...}`. The
// agentcore-invoke Lambda routes this envelope to the container in the same
// shape chat turns take today (it's just a different request body).
//
// RequestResponse invocation per auto-memory feedback_avoid_fire_and_forget_lambda_invokes:
// user-driven create MUST surface errors. The caller inspects `ok` and
// either transitions the skill_runs row out of `running` or returns the
// error to the client.

let _compositionInvokeFnName: string | null | undefined;
async function getCompositionInvokeFnName(): Promise<string | null> {
  if (_compositionInvokeFnName !== undefined) return _compositionInvokeFnName;
  // Reuse the same Lambda as chat invocation — there's exactly one
  // agentcore-invoke Lambda, it just handles multiple envelope kinds.
  const envName = process.env.AGENTCORE_FUNCTION_NAME;
  if (envName) {
    _compositionInvokeFnName = envName;
    return _compositionInvokeFnName;
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
    _compositionInvokeFnName = res.Parameter?.Value || null;
  } catch (err) {
    console.warn(
      `[graphql] composition invoke SSM lookup failed: ${(err as Error)?.name}: ${(err as Error)?.message}`,
    );
    _compositionInvokeFnName = null;
  }
  return _compositionInvokeFnName;
}

export type CompositionInvokePayload = {
  kind: "run_skill";
  runId: string;
  tenantId: string;
  invokerUserId: string;
  skillId: string;
  skillVersion: number;
  invocationSource: string;
  resolvedInputs: Record<string, unknown>;
  // snake_case — composition_runner._scope_to_inputs (Python) reads
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

export type CompositionInvokeResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Invoke the composition runner inside the AgentCore container. Synchronous
 * (RequestResponse) so failures surface to startSkillRun and the mutation
 * can transition the run row out of `running`.
 */
export async function invokeComposition(
  payload: CompositionInvokePayload,
): Promise<CompositionInvokeResult> {
  try {
    const fnName = await getCompositionInvokeFnName();
    if (!fnName) {
      return {
        ok: false,
        error:
          "agentcore-invoke Lambda name not configured (AGENTCORE_FUNCTION_NAME / SSM)",
      };
    }
    const { LambdaClient, InvokeCommand } =
      await import("@aws-sdk/client-lambda");
    const { NodeHttpHandler } = await import("@smithy/node-http-handler");
    // 28s socketTimeout leaves 2s headroom before the graphql-http
    // Lambda's 30s ceiling (and API Gateway's 29s cap). Without it a
    // slow agentcore can block past those limits and we lose the chance
    // to transition skill_runs out of `running` before the client
    // times out.
    const lambda = new LambdaClient({
      requestHandler: new NodeHttpHandler({ socketTimeout: 28_000 }),
    });
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
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(lambdaPayload),
      }),
    );
    if (res.FunctionError) {
      const raw = res.Payload ? new TextDecoder().decode(res.Payload) : "";
      return {
        ok: false,
        error: `composition invoke threw: ${raw || res.FunctionError}`,
      };
    }
    if (res.Payload) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(res.Payload)) as {
          statusCode?: number;
          body?: string;
        };
        if (typeof parsed.statusCode === "number" && parsed.statusCode >= 400) {
          const inner =
            typeof parsed.body === "string"
              ? parsed.body
              : JSON.stringify(parsed.body);
          return {
            ok: false,
            error: `composition invoke returned ${parsed.statusCode}: ${inner}`,
          };
        }
      } catch {
        // Non-JSON response — treat as opaque success since FunctionError was not set.
      }
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[graphql] Failed to invoke composition:", err);
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

const ENUM_FIELDS = new Set(["status", "priority", "type", "channel"]);

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
  for (const field of ["status", "type"]) {
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
