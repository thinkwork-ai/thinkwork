import type { GraphQLContext } from "../../context.js";
import { db, computers, generateSlug } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  assertNoActiveComputer,
  parseJsonInput,
  requireComputerTemplate,
  requireTenantAgent,
  requireTenantUser,
  toGraphqlComputer,
} from "./shared.js";

export async function createComputer(
  _parent: any,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const input = args.input;
  await requireTenantAdmin(ctx, input.tenantId);
  await requireTenantUser(input.tenantId, input.ownerUserId);
  await requireComputerTemplate(input.tenantId, input.templateId);
  if (input.migratedFromAgentId) {
    await requireTenantAgent(input.tenantId, input.migratedFromAgentId);
  }
  await assertNoActiveComputer(input.tenantId, input.ownerUserId);

  const callerUserId = await resolveCallerUserId(ctx);
  const [row] = await db
    .insert(computers)
    .values({
      tenant_id: input.tenantId,
      owner_user_id: input.ownerUserId,
      template_id: input.templateId,
      name: input.name,
      slug: input.slug ?? generateSlug(),
      runtime_config:
        input.runtimeConfig === undefined
          ? undefined
          : parseJsonInput(input.runtimeConfig),
      budget_monthly_cents: input.budgetMonthlyCents,
      migrated_from_agent_id: input.migratedFromAgentId,
      migration_metadata:
        input.migrationMetadata === undefined
          ? undefined
          : parseJsonInput(input.migrationMetadata),
      created_by: callerUserId,
    })
    .returning();

  return toGraphqlComputer(row);
}
