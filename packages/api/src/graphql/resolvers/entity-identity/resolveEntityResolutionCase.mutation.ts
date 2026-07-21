/**
 * Link / Create / Defer / Reject decision mutation (THINK-193 U4).
 * Tenant-admin gated; every decision appends an audit event via
 * resolution.applyResolutionDecision.
 */

import { and, eq } from "drizzle-orm";
import { entityResolutionCases as casesTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { nudgeIdentityGraphProjector } from "../../../lib/entity-identity/graph-projection.js";
import {
  applyResolutionDecision,
  type ResolutionDecisionInput,
} from "../../../lib/entity-identity/resolution.js";
import { resolveTenantId } from "./canonicalEntities.query.js";
import { toGraphqlResolutionCase } from "./entityResolutionCases.query.js";

interface ResolveCaseArgs {
  tenantId?: string | null;
  caseId: string;
  decision: "link" | "create" | "defer" | "reject";
  canonicalEntityId?: string | null;
  displayName?: string | null;
}

export async function resolveEntityResolutionCase(
  _parent: unknown,
  args: ResolveCaseArgs,
  ctx: GraphQLContext,
) {
  const tenantId = await resolveTenantId(ctx, args.tenantId);
  const actorUserId = await resolveCallerUserId(ctx);

  let input: ResolutionDecisionInput;
  switch (args.decision) {
    case "link":
      if (!args.canonicalEntityId) {
        throw new Error("canonicalEntityId is required for a link decision");
      }
      input = { decision: "link", canonicalEntityId: args.canonicalEntityId };
      break;
    case "create":
      input = {
        decision: "create",
        displayName: args.displayName ?? undefined,
      };
      break;
    case "defer":
      input = { decision: "defer" };
      break;
    case "reject":
      input = { decision: "reject" };
      break;
    default:
      throw new Error(`Unsupported decision: ${String(args.decision)}`);
  }

  await applyResolutionDecision(ctx.db, {
    tenantId,
    caseId: args.caseId,
    actorUserId,
    input,
  });

  // Company Brain U5 (KTD-4): decision committed — nudge the twin graph
  // projector (fire-and-forget; cursor makes missed nudges harmless).
  await nudgeIdentityGraphProjector(tenantId);

  const [row] = await ctx.db
    .select()
    .from(casesTable)
    .where(
      and(eq(casesTable.id, args.caseId), eq(casesTable.tenant_id, tenantId)),
    )
    .limit(1);
  if (!row) throw new Error("Resolution case not found after decision");
  return toGraphqlResolutionCase(row as typeof casesTable.$inferSelect);
}
