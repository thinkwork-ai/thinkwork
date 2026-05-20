import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { createComputerCore, toGraphqlComputer } from "./shared.js";

export async function createComputer(
  _parent: any,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const input = args.input;
  await requireAdminOrServiceCaller(ctx, input.tenantId, "create_computer");
  const callerUserId = await resolveCallerUserId(ctx);
  const row = await createComputerCore({
    tenantId: input.tenantId,
    ownerUserId: null,
    name: input.name,
    slug: input.slug,
    scope: input.scope,
    runtimeConfig: input.runtimeConfig,
    budgetMonthlyCents: input.budgetMonthlyCents,
    migratedFromAgentId: input.migratedFromAgentId,
    primaryAgentId: input.primaryAgentId,
    migrationMetadata: input.migrationMetadata,
    createdBy: callerUserId,
  });
  return toGraphqlComputer(row);
}
