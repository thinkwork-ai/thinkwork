import { GraphQLError } from "graphql";

import { asc, db, sql, workItems } from "../../graphql/utils.js";

const DEFAULT_CLAIM_LEASE_SECONDS = 15 * 60;
const MAX_CLAIM_LEASE_SECONDS = 24 * 60 * 60;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;

export type OpenEngineWorkItem = typeof workItems.$inferSelect;

export interface OpenEngineQueueScope {
  tenantId: string;
  queueKey?: string | null;
}

export interface ListEligibleOpenEngineWorkItemsInput extends OpenEngineQueueScope {
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
    .orderBy(openEnginePriorityOrder(), asc(workItems.updated_at))
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
         ORDER BY ${openEnginePriorityOrder()}, ${workItems.updated_at} ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )`,
    )
    .returning();

  return claimed ?? null;
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

function openEnginePriorityOrder() {
  return sql`CASE ${workItems.priority}
    WHEN 'urgent' THEN 0
    WHEN 'high' THEN 1
    WHEN 'normal' THEN 2
    WHEN 'low' THEN 3
    ELSE 4
  END ASC,
  COALESCE(${workItems.open_engine_scheduled_at}, ${workItems.created_at}) ASC`;
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
