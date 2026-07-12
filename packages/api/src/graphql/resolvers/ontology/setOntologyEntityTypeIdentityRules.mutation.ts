import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { setOntologyEntityTypeIdentityRules } from "../../../lib/ontology/repository.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

interface SetIdentityRulesArgs {
  tenantId?: string | null;
  entityTypeId: string;
  /** AWSJSON — array of identity rules; malformed entries drop on parse. */
  rules: unknown;
}

export const setOntologyEntityTypeIdentityRulesMutation = async (
  _parent: unknown,
  args: SetIdentityRulesArgs,
  ctx: GraphQLContext,
) => {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireAdminOrServiceCaller(
    ctx,
    tenantId,
    "set_ontology_entity_type_identity_rules",
  );
  const actorUserId = await resolveCallerUserId(ctx);
  const rules =
    typeof args.rules === "string" ? JSON.parse(args.rules) : args.rules;
  return setOntologyEntityTypeIdentityRules({
    tenantId,
    entityTypeId: args.entityTypeId,
    rules,
    actorUserId,
  });
};
