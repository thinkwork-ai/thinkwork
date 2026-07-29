/**
 * startIdentityMatchJob (THINK-321 U7, KTD-7) — operator/service gated.
 * Durable dedupe-key insert-or-load,
 * async Event invoke of the identity-match Lambda, invoke failure marked
 * on the row. The caller polls identityMatchJob.
 */

import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { startIdentityMatchJob as startIdentityMatchJobLib } from "../../../lib/entity-identity/bootstrap.js";

export const startIdentityMatchJob = async (
  _parent: unknown,
  args: {
    input: {
      tenantId: string;
      trigger?: string | null;
      dedupeKey?: string | null;
      sourceSystems?: string[] | null;
    };
  },
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(
    ctx,
    args.input.tenantId,
    "start_identity_match_job",
  );
  return startIdentityMatchJobLib({
    tenantId: args.input.tenantId,
    trigger: args.input.trigger,
    dedupeKey: args.input.dedupeKey,
    sourceSystems: args.input.sourceSystems ?? undefined,
  });
};
