import { and, desc, eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { n8nAgentStepRuns as n8nAgentStepRunsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db as defaultDb } from "../../utils.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

type DbLike = typeof defaultDb;
type RunRow = typeof n8nAgentStepRunsTable.$inferSelect;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const PREVIEW_LIMIT = 1000;

export interface N8nAgentStepTelemetryArgs {
  threadId?: string | null;
  limit?: number | null;
}

export interface LoadN8nAgentStepTelemetryArgs extends N8nAgentStepTelemetryArgs {
  tenantId: string;
  pluginInstallId?: string | null;
  managedApplicationId?: string | null;
  db?: DbLike;
}

export const n8nAgentStepRunQueries = {
  n8nAgentStepRuns,
};

export async function n8nAgentStepRuns(
  _parent: unknown,
  args: N8nAgentStepTelemetryArgs,
  ctx: GraphQLContext,
) {
  const tenantId = await resolveCallerTenantId(ctx);
  if (!tenantId) return [];
  return loadN8nAgentStepRunTelemetry({ tenantId, ...args });
}

export async function loadN8nAgentStepRunTelemetry({
  tenantId,
  threadId,
  pluginInstallId,
  managedApplicationId,
  limit,
  db = defaultDb,
}: LoadN8nAgentStepTelemetryArgs) {
  const safeLimit = normalizeLimit(limit);
  const conditions = [eq(n8nAgentStepRunsTable.tenant_id, tenantId)];
  if (threadId) conditions.push(eq(n8nAgentStepRunsTable.thread_id, threadId));
  if (pluginInstallId) {
    conditions.push(
      eq(n8nAgentStepRunsTable.plugin_install_id, pluginInstallId),
    );
  }
  if (managedApplicationId) {
    conditions.push(
      eq(n8nAgentStepRunsTable.managed_application_id, managedApplicationId),
    );
  }

  const rows = await db
    .select()
    .from(n8nAgentStepRunsTable)
    .where(and(...conditions))
    .orderBy(desc(n8nAgentStepRunsTable.updated_at))
    .limit(safeLimit);

  return rows.map(toN8nAgentStepRunTelemetry);
}

export function toN8nAgentStepRunTelemetry(row: RunRow) {
  return {
    id: row.id,
    pluginInstallId: row.plugin_install_id,
    managedApplicationId: row.managed_application_id,
    spaceId: row.space_id,
    agentId: row.agent_id,
    threadId: row.thread_id,
    threadTurnId: row.thread_turn_id,
    openingMessageId: row.opening_message_id,
    status: row.status,
    resumeStatus: row.resume_status,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    executionId: row.execution_id,
    stepId: row.step_id,
    correlationId: row.correlation_id,
    requestId: row.request_id,
    instructionsPreview: row.instructions_preview,
    inputPreview: row.input_preview,
    outputPreview: outputPreview(row),
    errorMessage: errorMessage(row.error_payload ?? row.result_payload),
    summary: bounded(row.summary),
    links: row.links,
    timeoutSeconds: row.timeout_seconds,
    expiresAt: row.expires_at,
    resumeAttemptCount: row.resume_attempt_count,
    nextResumeAttemptAt: row.next_resume_attempt_at,
    lastResumeAttemptAt: row.last_resume_attempt_at,
    lastResumeHttpStatus: row.last_resume_http_status,
    lastResumeError: bounded(row.last_resume_error),
    resumedAt: row.resumed_at,
    terminalAt: row.terminal_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeLimit(limit: number | null | undefined) {
  if (limit == null) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new GraphQLError("limit must be a positive integer", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return Math.min(limit, MAX_LIMIT);
}

function outputPreview(row: RunRow): string | null {
  return bounded(row.summary) ?? resultSummaryPreview(row.result_payload);
}

function resultSummaryPreview(value: unknown): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["summary", "preview"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return bounded(candidate);
      }
    }
  }
  return null;
}

function errorMessage(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return bounded(value);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["message", "error", "reason", "code"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return bounded(candidate);
      }
    }
  }
  return null;
}

function bounded(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > PREVIEW_LIMIT
    ? `${value.slice(0, PREVIEW_LIMIT)}...`
    : value;
}
