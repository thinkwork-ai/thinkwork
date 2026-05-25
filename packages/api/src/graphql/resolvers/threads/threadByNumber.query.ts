import type { GraphQLContext } from "../../context.js";
import { db, eq, and, threads, threadToCamel } from "../../utils.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "./access.js";

export const threadByNumber = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const conditions: any[] = [
    eq(threads.tenant_id, args.tenantId),
    eq(threads.number, args.number),
  ];

  if (ctx.auth?.authType === "cognito") {
    const callerTenantId = await resolveCallerTenantId(ctx);
    if (!callerTenantId || callerTenantId !== args.tenantId) return null;
    const callerUserId = await resolveCallerUserId(ctx);
    if (!callerUserId) return null;
    conditions.push(callerVisibleThreadPredicate(args.tenantId, callerUserId));
  }

  const [row] = await db
    .select()
    .from(threads)
    .where(and(...conditions));
  return row ? threadToCamel(row) : null;
};
