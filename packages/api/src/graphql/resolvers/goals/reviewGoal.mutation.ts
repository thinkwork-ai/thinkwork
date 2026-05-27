import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  goals,
  spaceMembers,
  threadToCamel,
  threads,
} from "../../utils.js";
import { refreshCustomerOnboardingGoalFolderSafely } from "../../../lib/spaces/customer-onboarding-goal-md.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { threadGoalToGraphql } from "./threadGoal.query.js";
import {
  finalizeCompletedThreadGoal,
  withGoalCompletionMetadata,
} from "../../../lib/thread-goals/completion.js";

type ReviewGoalAction = "CONFIRM_COMPLETION" | "REQUEST_CHANGES" | "CANCEL";

type ReviewGoalArgs = {
  input: {
    tenantId: string;
    goalId: string;
    action: string;
    notes?: string | null;
  };
};

export async function reviewGoal(
  _parent: unknown,
  args: ReviewGoalArgs,
  ctx: GraphQLContext,
) {
  const input = args.input;
  const action = parseAction(input.action);
  const now = new Date();

  const row = await loadGoalForReview(input.tenantId, input.goalId);
  if (!row) {
    throw new GraphQLError("Goal not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  const callerUserId = await authorizeGoalReview(ctx, row);
  let reviewMetadata = buildReviewMetadata(row.metadata, {
    action,
    notes: cleanNotes(input.notes),
    reviewedAt: now,
    reviewedByUserId: callerUserId,
  });

  let nextGoalStatus: "active" | "completed" | "cancelled";
  let threadUpdates: Record<string, unknown>;
  if (action === "CONFIRM_COMPLETION") {
    assertInReview(row.status, action);
    nextGoalStatus = "completed";
    reviewMetadata = withGoalCompletionMetadata({
      current: reviewMetadata,
      completedAt: now,
      completedByUserId: callerUserId,
    });
    threadUpdates = {
      status: "done",
      completed_at: now,
      cancelled_at: null,
      closed_at: now,
      checkout_run_id: null,
      updated_at: now,
    };
  } else if (action === "REQUEST_CHANGES") {
    assertInReview(row.status, action);
    nextGoalStatus = "active";
    threadUpdates = {
      status: "in_progress",
      started_at: row.thread_started_at ?? now,
      completed_at: null,
      cancelled_at: null,
      closed_at: null,
      checkout_run_id: null,
      updated_at: now,
    };
  } else {
    if (row.status === "completed" || row.status === "cancelled") {
      throw new GraphQLError("Only non-terminal Goals can be cancelled", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    nextGoalStatus = "cancelled";
    threadUpdates = {
      status: "cancelled",
      completed_at: null,
      cancelled_at: now,
      closed_at: now,
      checkout_run_id: null,
      updated_at: now,
    };
  }

  const [updatedGoal] = await db
    .update(goals)
    .set({
      status: nextGoalStatus,
      reviewer_type: "user",
      reviewer_id: callerUserId,
      reviewed_at: now,
      completed_at: nextGoalStatus === "completed" ? now : null,
      cancelled_at: nextGoalStatus === "cancelled" ? now : null,
      metadata: reviewMetadata,
      updated_at: now,
    })
    .where(eq(goals.id, row.id))
    .returning();

  const [updatedThread] = await db
    .update(threads)
    .set(threadUpdates)
    .where(eq(threads.id, row.thread_id))
    .returning();

  if (nextGoalStatus === "completed") {
    await finalizeCompletedThreadGoal({
      tenantId: row.tenant_id,
      threadId: row.thread_id,
    });
  } else {
    await refreshCustomerOnboardingGoalFolderSafely(
      { tenantId: row.tenant_id, threadId: row.thread_id },
      { goalStatus: nextGoalStatus },
    );
  }

  return {
    goal: threadGoalToGraphql({
      ...updatedGoal,
      agent_id: row.agent_id,
      user_id: row.user_id,
    }),
    thread: threadToCamel(updatedThread),
  };
}

async function loadGoalForReview(tenantId: string, goalId: string) {
  const [row] = await db
    .select({
      id: goals.id,
      tenant_id: goals.tenant_id,
      space_id: goals.space_id,
      thread_id: goals.thread_id,
      agent_id: threads.agent_id,
      user_id: threads.user_id,
      template_key: goals.template_key,
      outcome: goals.outcome,
      owner_type: goals.owner_type,
      owner_id: goals.owner_id,
      mode: goals.mode,
      status: goals.status,
      progress_model: goals.progress_model,
      completion_rule: goals.completion_rule,
      review_policy: goals.review_policy,
      reviewer_type: goals.reviewer_type,
      reviewer_id: goals.reviewer_id,
      started_at: goals.started_at,
      reviewed_at: goals.reviewed_at,
      completed_at: goals.completed_at,
      cancelled_at: goals.cancelled_at,
      metadata: goals.metadata,
      created_at: goals.created_at,
      updated_at: goals.updated_at,
      thread_status: threads.status,
      thread_started_at: threads.started_at,
    })
    .from(goals)
    .innerJoin(
      threads,
      and(
        eq(threads.id, goals.thread_id),
        eq(threads.tenant_id, goals.tenant_id),
      ),
    )
    .where(and(eq(goals.tenant_id, tenantId), eq(goals.id, goalId)))
    .limit(1);
  return row;
}

async function authorizeGoalReview(
  ctx: GraphQLContext,
  row: Awaited<ReturnType<typeof loadGoalForReview>>,
): Promise<string> {
  if (!row) {
    throw new GraphQLError("Goal not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  if (ctx.auth.authType !== "cognito") {
    throw forbidden();
  }

  const callerTenantId = await resolveCallerTenantId(ctx);
  if (!callerTenantId || callerTenantId !== row.tenant_id) {
    throw forbidden();
  }

  const callerUserId = await resolveCallerUserId(ctx);
  if (!callerUserId) throw forbidden();

  if (row.owner_type === "user" && row.owner_id === callerUserId) {
    return callerUserId;
  }
  if (row.reviewer_type === "user" && row.reviewer_id === callerUserId) {
    return callerUserId;
  }
  if (await isSpaceOwnerOrAdmin(row.tenant_id, row.space_id, callerUserId)) {
    return callerUserId;
  }
  try {
    await requireTenantAdmin(ctx, row.tenant_id);
    return callerUserId;
  } catch {
    throw forbidden();
  }
}

async function isSpaceOwnerOrAdmin(
  tenantId: string,
  spaceId: string,
  userId: string,
): Promise<boolean> {
  const [member] = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.tenant_id, tenantId),
        eq(spaceMembers.space_id, spaceId),
        eq(spaceMembers.user_id, userId),
      ),
    )
    .limit(1);
  return member?.role === "owner" || member?.role === "admin";
}

function parseAction(value: string): ReviewGoalAction {
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "CONFIRM_COMPLETION" ||
    normalized === "REQUEST_CHANGES" ||
    normalized === "CANCEL"
  ) {
    return normalized;
  }
  throw new GraphQLError(`Unsupported Goal review action: ${value}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function assertInReview(status: string, action: ReviewGoalAction): void {
  if (status === "in_review") return;
  throw new GraphQLError(`${action} requires an in-review Goal`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function buildReviewMetadata(
  current: unknown,
  review: {
    action: ReviewGoalAction;
    notes: string | null;
    reviewedAt: Date;
    reviewedByUserId: string;
  },
) {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return compactObject({
    ...base,
    review: compactObject({
      action: review.action,
      notes: review.notes,
      reviewedAt: review.reviewedAt.toISOString(),
      reviewedByUserId: review.reviewedByUserId,
    }),
  });
}

function cleanNotes(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}

function forbidden() {
  return new GraphQLError("Not authorized to review this Goal", {
    extensions: { code: "FORBIDDEN" },
  });
}
