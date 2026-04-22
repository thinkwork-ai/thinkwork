import type { GraphQLContext } from "../../context.js";
import { db, teams, snakeToCamel, generateSlug } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { runWithIdempotency } from "../../../lib/idempotency.js";

export const createTeam = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;
  await requireTenantAdmin(ctx, i.tenantId);

  // Apikey callers (thinkwork-admin) set principalId directly; cognito
  // callers go through the users-lookup path. Null → runWithIdempotency
  // short-circuits to a plain fn() call, preserving admin SPA / CLI.
  const invokerUserId =
    ctx.auth.authType === "apikey"
      ? ctx.auth.principalId
      : await resolveCallerUserId(ctx);

  return runWithIdempotency({
    tenantId: i.tenantId,
    invokerUserId,
    mutationName: "createTeam",
    inputs: i,
    clientKey: i.idempotencyKey ?? null,
    fn: () => createTeamCore(i),
  });
};

async function createTeamCore(i: any) {
  const [row] = await db
    .insert(teams)
    .values({
      tenant_id: i.tenantId,
      name: i.name,
      slug: generateSlug(),
      description: i.description,
      type: i.type ?? "team",
      budget_monthly_cents: i.budgetMonthlyCents,
      metadata: i.metadata ? JSON.parse(i.metadata) : undefined,
    })
    .returning();
  return snakeToCamel(row);
}
