import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, spaces } from "../../utils.js";
import { resolveTenantPlatformAgent } from "../../../lib/agents/tenant-platform-agent.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  assertTenantGuardrail,
  forbidden,
  sandboxBaselineEnabled,
} from "../tenant-agent/shared.js";
import { toGraphqlSpace } from "./shared.js";

interface SetSpaceRuntimeOverridesInput {
  model?: string | null;
  guardrailId?: string | null;
  budgetMonthlyCents?: number | null;
  budgetPaused?: boolean | null;
  sandbox?: boolean | null;
}

export async function setSpaceRuntimeOverrides(
  _parent: unknown,
  args: { spaceId: string; input: SetSpaceRuntimeOverridesInput },
  ctx: GraphQLContext,
) {
  const [space] = await db
    .select({ tenant_id: spaces.tenant_id })
    .from(spaces)
    .where(eq(spaces.id, args.spaceId));
  if (!space) throw new GraphQLError("Space not found");

  await requireAdminOrServiceCaller(
    ctx,
    space.tenant_id,
    "space_runtime_overrides:update",
  );

  const i = args.input ?? {};
  await assertTenantGuardrail(space.tenant_id, i.guardrailId);

  if (i.sandbox === true) {
    const platformAgent = await resolveTenantPlatformAgent(space.tenant_id, db);
    if (!sandboxBaselineEnabled(platformAgent.sandbox)) {
      throw forbidden("Space sandbox override cannot loosen platform baseline");
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (i.model !== undefined) updates.model_override = i.model;
  if (i.guardrailId !== undefined)
    updates.guardrail_id_override = i.guardrailId;
  if (i.budgetMonthlyCents !== undefined) {
    updates.budget_monthly_cents_override = i.budgetMonthlyCents;
  }
  if (i.budgetPaused !== undefined)
    updates.budget_paused_override = i.budgetPaused;
  if (i.sandbox !== undefined) updates.sandbox_override = i.sandbox;

  const [row] = await db
    .update(spaces)
    .set(updates)
    .where(
      and(eq(spaces.id, args.spaceId), eq(spaces.tenant_id, space.tenant_id)),
    )
    .returning();

  if (!row) throw new GraphQLError("Space not found");
  return toGraphqlSpace(row);
}
