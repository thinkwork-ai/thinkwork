import type { GraphQLContext } from "../../context.js";
import { and, db, eq, spaces } from "../../utils.js";
import { canReadTenantSpaces, toGraphqlSpace } from "./shared.js";

export const CUSTOMER_ONBOARDING_TEMPLATE_KEY = "customer_onboarding";

export async function customerOnboardingSpace(
  _parent: any,
  args: { tenantId: string },
  ctx: GraphQLContext,
) {
  if (!(await canReadTenantSpaces(ctx, args.tenantId))) {
    return null;
  }

  const [row] = await db
    .select()
    .from(spaces)
    .where(
      and(
        eq(spaces.tenant_id, args.tenantId),
        eq(spaces.template_key, CUSTOMER_ONBOARDING_TEMPLATE_KEY),
        eq(spaces.status, "active"),
      ),
    );
  return row ? toGraphqlSpace(row) : null;
}
