import type { GraphQLContext } from "../../context.js";
import { and, desc, db, eq, skillDrafts } from "../../utils.js";
import {
  isTenantOperator,
  loadRequesters,
  resolveReadTenant,
  toDraftPayload,
  toGraphqlDraftSummary,
} from "./shared.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

export async function skillDraftsQuery(
  _parent: unknown,
  args: { status?: string | null; requesterId?: string | null },
  ctx: GraphQLContext,
) {
  const tenantId = await resolveReadTenant(ctx);
  const [callerUserId, operator] = await Promise.all([
    resolveCallerUserId(ctx),
    isTenantOperator(ctx, tenantId),
  ]);
  const requesterId = operator
    ? args.requesterId
    : (callerUserId ?? "__no_user__");
  const conditions = [eq(skillDrafts.tenant_id, tenantId)];
  if (args.status) conditions.push(eq(skillDrafts.status, args.status));
  if (requesterId) {
    conditions.push(eq(skillDrafts.requested_by_user_id, requesterId));
  }
  const rows = await db
    .select()
    .from(skillDrafts)
    .where(and(...conditions))
    .orderBy(desc(skillDrafts.updated_at));
  const requesters = await loadRequesters(rows);
  return rows.map((row) =>
    toGraphqlDraftSummary(
      toDraftPayload(row, requesters.get(row.requested_by_user_id)),
    ),
  );
}
