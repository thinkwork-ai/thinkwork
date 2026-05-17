import type { GraphQLContext } from "../../context.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { createComputerCore, toGraphqlComputer } from "./shared.js";

export async function createComputer(
  _parent: any,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const input = args.input;
  await requireTenantAdmin(ctx, input.tenantId);
  const callerUserId = await resolveCallerUserId(ctx);
  const row = await createComputerCore({
    tenantId: input.tenantId,
    ownerUserId: input.ownerUserId,
    templateId: input.templateId,
    name: input.name,
    slug: input.slug,
    scope: input.scope,
    runtimeConfig: input.runtimeConfig,
    budgetMonthlyCents: input.budgetMonthlyCents,
    migratedFromAgentId: input.migratedFromAgentId,
    migrationMetadata: input.migrationMetadata,
    createdBy: callerUserId,
  });
  return toGraphqlComputer(row);
}
