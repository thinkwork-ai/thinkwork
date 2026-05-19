import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import { and, db, eq, spaces, threads, threadToCamel } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import { hasSpaceMemberAccess } from "./shared.js";
import {
  CUSTOMER_ONBOARDING_TEMPLATE_KEY,
  CustomerOnboardingWorkflowError,
  startCustomerOnboardingWorkflow,
} from "../../../lib/spaces/customer-onboarding-workflow.js";

interface StartCustomerOnboardingArgs {
  input: {
    tenantId: string;
    spaceId?: string | null;
    opportunity: Record<string, unknown> | string;
  };
}

export async function startCustomerOnboarding(
  _parent: unknown,
  args: StartCustomerOnboardingArgs,
  ctx: GraphQLContext,
) {
  if (ctx.auth.authType === "cognito") {
    await requireTenantMember(ctx, args.input.tenantId);
  }

  const caller = await resolveCallerFromAuth(ctx.auth);
  const spaceId = await resolveAuthorizedSpaceId(ctx, args.input);
  try {
    const result = await startCustomerOnboardingWorkflow({
      tenantId: args.input.tenantId,
      spaceId,
      source: "manual",
      opportunity: parseOpportunityInput(args.input.opportunity),
      startedBy: {
        type: "user",
        id: caller.userId,
      },
    });
    const [threadRow] = await db
      .select()
      .from(threads)
      .where(eq(threads.id, result.thread.id));
    return {
      thread: threadRow ? threadToCamel(threadRow) : result.thread,
      threadId: result.thread.id,
      idempotent: result.idempotent,
      missingFields: result.missingFields,
      linkedTasks: result.linkedTasks,
    };
  } catch (error) {
    if (error instanceof CustomerOnboardingWorkflowError) {
      throw new GraphQLError(error.message, {
        extensions: { code: error.code, http: { status: error.status } },
      });
    }
    throw error;
  }
}

async function resolveAuthorizedSpaceId(
  ctx: GraphQLContext,
  input: StartCustomerOnboardingArgs["input"],
): Promise<string | null> {
  if (ctx.auth.authType !== "cognito") return input.spaceId ?? null;

  const spaceId =
    input.spaceId ??
    (await findDefaultCustomerOnboardingSpaceId(input.tenantId));
  if (spaceId && !(await hasSpaceMemberAccess(ctx, input.tenantId, spaceId))) {
    throw new GraphQLError("Space membership required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  return spaceId;
}

async function findDefaultCustomerOnboardingSpaceId(
  tenantId: string,
): Promise<string | null> {
  const [space] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.tenant_id, tenantId),
        eq(spaces.template_key, CUSTOMER_ONBOARDING_TEMPLATE_KEY),
        eq(spaces.status, "active"),
      ),
    )
    .limit(1);
  return space?.id ?? null;
}

function parseOpportunityInput(
  input: Record<string, unknown> | string,
): Record<string, unknown> {
  if (typeof input !== "string") return input;
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new GraphQLError("Invalid opportunity JSON", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}
