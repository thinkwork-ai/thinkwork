import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import { listApprovedModelCatalog } from "../../../lib/model-approvals.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export async function myApprovedModelCatalog(
  _parent: unknown,
  _args: unknown,
  ctx: GraphQLContext,
) {
  if (ctx.auth.authType !== "cognito") {
    throw new GraphQLError("Authentication required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const caller = await resolveCaller(ctx);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Authentication required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  return listApprovedModelCatalog({
    tenantId: caller.tenantId,
    userId: caller.userId,
  });
}
