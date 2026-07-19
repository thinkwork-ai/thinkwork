import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { authSubscriptionInvalidations } from "@thinkwork/database-pg/schema";

import { db } from "./db.js";
import { publishAppSyncMutation } from "./appsync-iam-publisher.js";

export const INVALIDATABLE_SUBSCRIPTION_FIELDS = [
  "ON_AGENT_STATUS_CHANGED",
  "ON_NEW_MESSAGE",
  "ON_HEARTBEAT_ACTIVITY",
  "ON_THREAD_UPDATED",
  "ON_THREAD_ACTIVITY",
  "ON_INBOX_ITEM_STATUS_CHANGED",
  "ON_THREAD_TURN_UPDATED",
  "ON_THREAD_TURN_STEP",
  "ON_ORG_UPDATED",
  "ON_COST_RECORDED",
  "ON_EVAL_RUN_UPDATED",
  "ON_WORKSPACE_ACCESS_REVOKED",
] as const;

export type SubscriptionInvalidationScope = "tenant" | "user" | "resource";

export interface SubscriptionInvalidationRow {
  id: string;
  tenantId: string;
  userId: string | null;
  resourceKind: string;
  resourceId: string | null;
  reason: string;
  attempts: number;
}

export interface SubscriptionInvalidationRepository {
  enqueue(input: {
    tenantId: string;
    userId?: string | null;
    resourceKind: string;
    resourceId?: string | null;
    reason: string;
  }): Promise<void>;
  claim(limit: number, now: Date): Promise<SubscriptionInvalidationRow[]>;
  complete(id: string, now: Date): Promise<void>;
  retry(id: string, attempts: number, availableAt: Date): Promise<void>;
  hasPending(input: {
    tenantId: string;
    userId?: string | null;
    resourceKind?: string | null;
    resourceId?: string | null;
  }): Promise<boolean>;
}

export async function enqueueSubscriptionInvalidation(
  input: {
    tenantId: string;
    userId?: string | null;
    resourceKind: string;
    resourceId?: string | null;
    reason: string;
  },
  repository: SubscriptionInvalidationRepository = createDbSubscriptionInvalidationRepository(),
): Promise<void> {
  await repository.enqueue(input);
}

export async function shouldSuppressSubscriptionDelivery(
  input: {
    tenantId: string;
    userId?: string | null;
    resourceKind?: string | null;
    resourceId?: string | null;
  },
  repository: SubscriptionInvalidationRepository = createDbSubscriptionInvalidationRepository(),
): Promise<boolean> {
  return repository.hasPending(input);
}

export async function processSubscriptionInvalidations(
  input: {
    repository?: SubscriptionInvalidationRepository;
    publish?: typeof publishAppSyncMutation;
    now?: Date;
    limit?: number;
  } = {},
): Promise<{ processed: number; retried: number }> {
  const repository =
    input.repository ?? createDbSubscriptionInvalidationRepository();
  const publish = input.publish ?? publishAppSyncMutation;
  const now = input.now ?? new Date();
  const rows = await repository.claim(input.limit ?? 25, now);
  let processed = 0;
  let retried = 0;
  for (const row of rows) {
    const scope = invalidationScope(row);
    let delivered = true;
    for (const subscriptionField of INVALIDATABLE_SUBSCRIPTION_FIELDS) {
      const ok = await publish(
        `mutation InvalidateSubscription(
          $subscriptionField: SubscriptionInvalidationField!
          $scope: String!
          $tenantId: ID!
          $userId: ID
          $resourceKind: String
          $resourceId: ID
        ) {
          invalidateSubscription(
            subscriptionField: $subscriptionField
            scope: $scope
            tenantId: $tenantId
            userId: $userId
            resourceKind: $resourceKind
            resourceId: $resourceId
          ) { subscriptionField scope tenantId }
        }`,
        {
          subscriptionField,
          scope,
          tenantId: row.tenantId,
          userId: row.userId,
          resourceKind: row.resourceKind,
          resourceId: row.resourceId,
        },
        { skipSuppression: true },
      );
      if (!ok) {
        delivered = false;
        break;
      }
    }
    if (delivered) {
      await repository.complete(row.id, now);
      processed += 1;
    } else {
      const attempts = row.attempts + 1;
      const delayMs = Math.min(300_000, 2 ** Math.min(attempts, 8) * 1_000);
      await repository.retry(
        row.id,
        attempts,
        new Date(now.getTime() + delayMs),
      );
      retried += 1;
    }
  }
  return { processed, retried };
}

function invalidationScope(
  row: Pick<SubscriptionInvalidationRow, "userId" | "resourceId">,
): SubscriptionInvalidationScope {
  if (row.resourceId) return "resource";
  if (row.userId) return "user";
  return "tenant";
}

export function createDbSubscriptionInvalidationRepository(): SubscriptionInvalidationRepository {
  return {
    async enqueue(input) {
      await db.insert(authSubscriptionInvalidations).values({
        tenant_id: input.tenantId,
        user_id: input.userId ?? null,
        resource_kind: input.resourceKind,
        resource_id: input.resourceId ?? null,
        reason: input.reason,
      });
    },
    async claim(limit, now) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .select({
            id: authSubscriptionInvalidations.id,
            tenantId: authSubscriptionInvalidations.tenant_id,
            userId: authSubscriptionInvalidations.user_id,
            resourceKind: authSubscriptionInvalidations.resource_kind,
            resourceId: authSubscriptionInvalidations.resource_id,
            reason: authSubscriptionInvalidations.reason,
            attempts: authSubscriptionInvalidations.attempts,
          })
          .from(authSubscriptionInvalidations)
          .where(
            and(
              inArray(authSubscriptionInvalidations.status, [
                "pending",
                "processing",
              ]),
              lte(authSubscriptionInvalidations.available_at, now),
            ),
          )
          .orderBy(asc(authSubscriptionInvalidations.created_at))
          .limit(limit)
          .for("update", { skipLocked: true });
        if (rows.length > 0) {
          await tx
            .update(authSubscriptionInvalidations)
            .set({
              status: "processing",
              // A crashed invocation is reclaimable after the lease. Keeping
              // the row in processing during the lease also keeps publisher
              // suppression active until invalidation actually completes.
              available_at: new Date(now.getTime() + 60_000),
            })
            .where(
              inArray(
                authSubscriptionInvalidations.id,
                rows.map((row) => row.id),
              ),
            );
        }
        return rows;
      });
    },
    async complete(id, now) {
      await db
        .update(authSubscriptionInvalidations)
        .set({ status: "complete", processed_at: now })
        .where(eq(authSubscriptionInvalidations.id, id));
    },
    async retry(id, attempts, availableAt) {
      await db
        .update(authSubscriptionInvalidations)
        .set({ status: "pending", attempts, available_at: availableAt })
        .where(eq(authSubscriptionInvalidations.id, id));
    },
    async hasPending(input) {
      // AppSync notification mutations fan out to every matching subscriber,
      // so a shared tenant/thread publish cannot exclude just the revoked
      // principal. Pause all delivery for the tenant while any invalidation is
      // pending. This is intentionally broader than the invalidation scope:
      // temporary loss of realtime fan-out is safer than one post-revocation
      // delivery. Publishing resumes after the worker closes matching sockets.
      const rows = await db
        .select({ id: authSubscriptionInvalidations.id })
        .from(authSubscriptionInvalidations)
        .where(
          and(
            eq(authSubscriptionInvalidations.tenant_id, input.tenantId),
            inArray(authSubscriptionInvalidations.status, [
              "pending",
              "processing",
            ]),
          ),
        )
        .limit(1);
      return rows.length === 1;
    },
  };
}
