/**
 * registerIdentitySource (THINK-321 U7, KTD-5) — operator/service gated.
 * Validation + writes live in lib/entity-identity/bootstrap.ts.
 */

import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { registerIdentitySource as registerIdentitySourceLib } from "../../../lib/entity-identity/bootstrap.js";

export const registerIdentitySource = async (
  _parent: unknown,
  args: {
    input: {
      tenantId: string;
      sourceSystem: string;
      connectorSlug: string;
      entityTypeSlugs: string[];
    };
  },
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(
    ctx,
    args.input.tenantId,
    "register_identity_source",
  );
  const result = await registerIdentitySourceLib({
    tenantId: args.input.tenantId,
    sourceSystem: args.input.sourceSystem,
    connectorSlug: args.input.connectorSlug,
    entityTypeSlugs: args.input.entityTypeSlugs,
  });
  return {
    tenantId: result.tenantId,
    sourceSystem: result.sourceSystem,
    connectorSlug: result.connectorSlug,
    entityTypeSlugs: result.entityTypeSlugs,
    routingMapAgents: result.routingMap.agents,
    routingMapWritten: result.routingMap.written,
  };
};
