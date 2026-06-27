import { GraphQLError } from "graphql";

import {
  asc,
  db,
  desc,
  sql,
  workItemLabelAssignments,
  workItemLabels,
  workItems,
} from "../../graphql/utils.js";

const DEFAULT_CLAIM_LEASE_SECONDS = 15 * 60;
const MAX_CLAIM_LEASE_SECONDS = 24 * 60 * 60;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;

export type OpenEngineWorkItem = typeof workItems.$inferSelect;
export type OpenEngineQueueState =
  | "eligible"
  | "claimed"
  | "stale_claim"
  | "scheduled"
  | "waiting"
  | "human_hold"
  | "blocked"
  | "completed"
  | "archived"
  | "disabled";

export interface OpenEngineQueueSnapshot {
  tenantId: string;
  queueKey: string | null;
  generatedAt: string;
  total: number;
  counts: Record<OpenEngineQueueState, number>;
  staleClaims: Array<{
    id: string;
    title: string;
    claimedByAgentId: string | null;
    claimExpiresAt: string | null;
  }>;
}

export interface OpenEngineQueueScope {
  tenantId: string;
  queueKey?: string | null;
  spaceId?: string | null;
  statusId?: string | null;
  labelSlugs?: string[] | null;
  ownerUserId?: string | null;
  ownerAgentId?: string | null;
  agentId?: string | null;
}

export interface ListEligibleOpenEngineWorkItemsInput
  extends OpenEngineQueueScope {
  now?: Date;
  limit?: number | null;
}

export interface ClaimNextOpenEngineWorkItemInput extends OpenEngineQueueScope {
  agentId: string;
  now?: Date;
  leaseSeconds?: number | null;
}

export async function listEligibleOpenEngineWorkItems(
  input: ListEligibleOpenEngineWorkItemsInput,
): Promise<OpenEngineWorkItem[]> {
  const now = input.now ?? new Date();
  return db
    .select()
    .from(workItems)
    .where(openEngineEligibilityPredicate(input, now))
    .orderBy(...openEngineQueueOrder())
    .limit(normalizeLimit(input.limit));
}

export async function claimNextOpenEngineWorkItem(
  input: ClaimNextOpenEngineWorkItemInput,
): Promise<OpenEngineWorkItem | null> {
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(
    now.getTime() + normalizeLeaseSeconds(input.leaseSeconds) * 1000,
  );

  const [claimed] = await db
    .update(workItems)
    .set({
      open_engine_claimed_by_agent_id: input.agentId,
      open_engine_claimed_at: now,
      open_engine_claim_expires_at: leaseExpiresAt,
      updated_at: now,
    })
    .where(
      sql`${workItems.id} = (
        SELECT ${workItems.id}
          FROM ${workItems}
         WHERE ${openEngineEligibilityPredicate(input, now)}
         ORDER BY ${sql.join(openEngineQueueOrder(), sql`, `)}
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )`,
    )
    .returning();

  return claimed ?? null;
}

export async function getOpenEngineQueueSnapshot(
  input: ListEligibleOpenEngineWorkItemsInput,
): Promise<OpenEngineQueueSnapshot> {
  const now = input.now ?? new Date();
  const rows = await db
    .select()
    .from(workItems)
    .where(openEngineSnapshotPredicate(input))
    .orderBy(...openEngineQueueOrder())
    .limit(normalizeLimit(input.limit ?? MAX_LIST_LIMIT));
  return buildOpenEngineQueueSnapshot(input, rows, now);
}

export function buildOpenEngineQueueSnapshot(
  input: OpenEngineQueueScope,
  rows: Array<Record<string, any>>,
  now: Date,
): OpenEngineQueueSnapshot {
  const counts = emptyQueueCounts();
  for (const row of rows) {
    counts[classifyOpenEngineQueueState(row, now)] += 1;
  }
  return {
    tenantId: input.tenantId,
    queueKey: input.queueKey ?? null,
    generatedAt: now.toISOString(),
    total: rows.length,
    counts,
    staleClaims: rows
      .filter((row) => classifyOpenEngineQueueState(row, now) === "stale_claim")
      .slice(0, 10)
      .map((row) => ({
        id: String(row.id),
        title: String(row.title ?? ""),
        claimedByAgentId: row.open_engine_claimed_by_agent_id ?? null,
        claimExpiresAt: iso(row.open_engine_claim_expires_at),
      })),
  };
}

export function classifyOpenEngineQueueState(
  row: Record<string, any>,
  now: Date,
): OpenEngineQueueState {
  if (row.archived_at) return "archived";
  if (row.completed_at) return "completed";
  if (row.open_engine_enabled !== true) return "disabled";
  if (row.blocked === true) return "blocked";
  if (row.open_engine_human_hold === true) return "human_hold";
  if (row.open_engine_dependency_state !== "ready") return "waiting";
  const scheduledAt = dateOrNull(row.open_engine_scheduled_at);
  if (scheduledAt && scheduledAt.getTime() > now.getTime()) return "scheduled";
  const claimedBy = row.open_engine_claimed_by_agent_id;
  if (claimedBy) {
    const expiresAt = dateOrNull(row.open_engine_claim_expires_at);
    if (!expiresAt || expiresAt.getTime() > now.getTime()) return "claimed";
    return "stale_claim";
  }
  return "eligible";
}

export function openEngineEligibilityPredicate(
  input: OpenEngineQueueScope,
  now: Date,
) {
  return sql`${workItems.tenant_id} = ${input.tenantId}
    AND ${workItems.open_engine_enabled} = true
    AND ${workItems.open_engine_queue_key} IS NOT DISTINCT FROM ${
      input.queueKey ?? null
    }
    ${input.spaceId ? sql`AND ${workItems.space_id} = ${input.spaceId}` : sql``}
    ${input.statusId ? sql`AND ${workItems.status_id} = ${input.statusId}` : sql``}
    ${
      input.ownerUserId
        ? sql`AND ${workItems.owner_user_id} = ${input.ownerUserId}`
        : sql``
    }
    ${
      (input.ownerAgentId ?? input.agentId)
        ? sql`AND ${workItems.owner_agent_id} = ${input.ownerAgentId ?? input.agentId}`
        : sql``
    }
    ${labelSlugsPredicate(input.tenantId, input.labelSlugs)}
    AND ${workItems.archived_at} IS NULL
    AND ${workItems.completed_at} IS NULL
    AND ${workItems.applicable} = true
    AND ${workItems.blocked} = false
    AND ${workItems.open_engine_human_hold} = false
    AND ${workItems.open_engine_dependency_state} = 'ready'
    AND (
      ${workItems.open_engine_scheduled_at} IS NULL
      OR ${workItems.open_engine_scheduled_at} <= ${now}
    )
    AND (
      ${workItems.open_engine_claimed_by_agent_id} IS NULL
      OR ${workItems.open_engine_claim_expires_at} IS NULL
      OR ${workItems.open_engine_claim_expires_at} <= ${now}
    )`;
}

function openEngineSnapshotPredicate(input: OpenEngineQueueScope) {
  return sql`${workItems.tenant_id} = ${input.tenantId}
    AND ${workItems.open_engine_enabled} = true
    AND ${workItems.open_engine_queue_key} IS NOT DISTINCT FROM ${
      input.queueKey ?? null
    }
    ${input.spaceId ? sql`AND ${workItems.space_id} = ${input.spaceId}` : sql``}
    ${input.statusId ? sql`AND ${workItems.status_id} = ${input.statusId}` : sql``}
    ${
      input.ownerUserId
        ? sql`AND ${workItems.owner_user_id} = ${input.ownerUserId}`
        : sql``
    }
    ${
      (input.ownerAgentId ?? input.agentId)
        ? sql`AND ${workItems.owner_agent_id} = ${input.ownerAgentId ?? input.agentId}`
        : sql``
    }
    ${labelSlugsPredicate(input.tenantId, input.labelSlugs)}`;
}

function labelSlugsPredicate(
  tenantId: string,
  labelSlugs: string[] | null | undefined,
) {
  const slugs = [...new Set((labelSlugs ?? []).map(normalizeLabelSlug))].filter(
    Boolean,
  );
  if (slugs.length === 0) return sql``;
  return sql`AND EXISTS (
    SELECT 1
      FROM ${workItemLabelAssignments} open_engine_wila
      JOIN ${workItemLabels} open_engine_wil
        ON open_engine_wil.id = open_engine_wila.label_id
       AND open_engine_wil.tenant_id = open_engine_wila.tenant_id
     WHERE open_engine_wila.tenant_id = ${tenantId}
       AND open_engine_wila.work_item_id = ${workItems.id}
       AND open_engine_wil.archived_at IS NULL
       AND open_engine_wil.slug IN (${sql.join(
         slugs.map((slug) => sql`${slug}`),
         sql`, `,
       )})
  )`;
}

function normalizeLabelSlug(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function openEngineQueueOrder() {
  return [
    sql`CASE ${workItems.priority}
    WHEN 'urgent' THEN 0
    WHEN 'high' THEN 1
    WHEN 'normal' THEN 2
    WHEN 'low' THEN 3
    ELSE 4
  END ASC`,
    desc(workItems.created_at),
    asc(workItems.id),
  ];
}

function normalizeLeaseSeconds(value: number | null | undefined) {
  const seconds = Number(value ?? DEFAULT_CLAIM_LEASE_SECONDS);
  if (
    !Number.isFinite(seconds) ||
    seconds < 1 ||
    seconds > MAX_CLAIM_LEASE_SECONDS
  ) {
    throw new GraphQLError("Open Engine claim lease must be 1-86400 seconds", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return Math.trunc(seconds);
}

function normalizeLimit(value: number | null | undefined) {
  const parsed = Number(value ?? DEFAULT_LIST_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIST_LIMIT);
}

function emptyQueueCounts(): Record<OpenEngineQueueState, number> {
  return {
    eligible: 0,
    claimed: 0,
    stale_claim: 0,
    scheduled: 0,
    waiting: 0,
    human_hold: 0,
    blocked: 0,
    completed: 0,
    archived: 0,
    disabled: 0,
  };
}

function dateOrNull(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function iso(value: unknown) {
  return dateOrNull(value)?.toISOString() ?? null;
}
