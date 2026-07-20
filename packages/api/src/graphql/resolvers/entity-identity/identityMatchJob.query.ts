/**
 * identityMatchJob (THINK-321 U7) — poll one match job row.
 * Operator/service gated.
 */

import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { loadIdentityMatchJob } from "../../../lib/entity-identity/bootstrap.js";

export const identityMatchJob = async (
  _parent: unknown,
  args: { tenantId: string; jobId: string },
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "identity_match_job");
  return loadIdentityMatchJob({
    tenantId: args.tenantId,
    jobId: args.jobId,
  });
};
