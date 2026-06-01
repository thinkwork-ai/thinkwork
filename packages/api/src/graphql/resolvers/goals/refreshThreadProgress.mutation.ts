import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import { and, db, eq, threads } from "../../utils.js";
import { refreshCustomerOnboardingGoalFolder } from "../../../lib/spaces/customer-onboarding-goal-md.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "../threads/access.js";
import { threadGoalFiles } from "./threadGoalFiles.query.js";

type RefreshThreadProgressArgs = {
  input: {
    tenantId: string;
    threadId: string;
  };
};

export async function refreshThreadProgress(
  _parent: unknown,
  args: RefreshThreadProgressArgs,
  ctx: GraphQLContext,
) {
  const { tenantId, threadId } = args.input;
  const visible = await canRefreshVisibleThread({ tenantId, threadId }, ctx);
  if (!visible) return { threadGoalFiles: null };

  try {
    const writes = await refreshCustomerOnboardingGoalFolder({
      tenantId,
      threadId,
    });
    console.info("[thread-progress] refreshed generated projections", {
      tenantId,
      threadId,
      files: writes?.map((write) => write.key) ?? [],
    });
  } catch (error) {
    console.warn("[thread-progress] refresh failed", {
      tenantId,
      threadId,
      error,
    });
    throw new GraphQLError("Failed to refresh thread progress.", {
      extensions: { code: "THREAD_PROGRESS_REFRESH_FAILED" },
    });
  }

  return {
    threadGoalFiles: await threadGoalFiles(null, { tenantId, threadId }, ctx),
  };
}

async function canRefreshVisibleThread(
  args: { tenantId: string; threadId: string },
  ctx: GraphQLContext,
): Promise<boolean> {
  let conditions = and(
    eq(threads.id, args.threadId),
    eq(threads.tenant_id, args.tenantId),
  );

  if (
    ctx.auth.authType === "service" &&
    ctx.auth.tenantId &&
    ctx.auth.tenantId !== args.tenantId
  ) {
    return false;
  }

  if (ctx.auth.authType === "cognito") {
    const callerTenantId = await resolveCallerTenantId(ctx);
    if (!callerTenantId || callerTenantId !== args.tenantId) return false;

    const callerUserId = await resolveCallerUserId(ctx);
    if (!callerUserId) return false;

    conditions = and(
      conditions,
      callerVisibleThreadPredicate(callerTenantId, callerUserId),
    );
  }

  const [thread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(conditions)
    .limit(1);
  return Boolean(thread);
}
