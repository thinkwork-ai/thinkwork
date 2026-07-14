/**
 * refreshAnalystDataSource (THINK-283 U5).
 *
 * Operator-facing entry point for the explicit fail-closed source refresh.
 * Requires tenant owner/admin — same boundary as the registration mutations.
 * The orchestration/lifecycle lives in lib/analyst/refresh-data-source.ts;
 * this resolver only authorizes and maps error classes:
 *   - AnalystRefreshInputError    → BAD_USER_INPUT (unknown/non-sourced row)
 *   - AnalystRefreshConflictError → CONFLICT (live lease / superseded)
 *   - AnalystRefreshStepError     → BAD_USER_INPUT with the sanitized step
 *     detail (also persisted on the row — visible after reload, retryable)
 */

import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import {
  AnalystRefreshConflictError,
  AnalystRefreshInputError,
  AnalystRefreshStepError,
  refreshAnalystDataSource as runRefresh,
  type RefreshAnalystDataSourceResult,
} from "../../../lib/analyst/refresh-data-source.js";
import type { CapabilitySignedBy } from "../../../lib/capabilities/sidecar-signing.js";

export const refreshAnalystDataSource = async (
  _parent: unknown,
  args: { serverId: string },
  ctx: GraphQLContext,
): Promise<RefreshAnalystDataSourceResult> => {
  const { userId, tenantId } = await resolveCaller(ctx);
  if (!tenantId) {
    throw new GraphQLError("Tenant context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  await requireTenantAdmin(ctx, tenantId);

  const signer = ctx.auth.email || userId || "unknown";
  const signedBy: CapabilitySignedBy = `operator:${signer}`;
  try {
    return await runRefresh({
      tenantId,
      serverId: args.serverId,
      signedBy,
    });
  } catch (err) {
    if (err instanceof AnalystRefreshInputError) {
      throw new GraphQLError(err.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    if (err instanceof AnalystRefreshConflictError) {
      throw new GraphQLError(err.message, { extensions: { code: "CONFLICT" } });
    }
    if (err instanceof AnalystRefreshStepError) {
      throw new GraphQLError(err.message, {
        extensions: { code: "BAD_USER_INPUT", refreshStep: err.step },
      });
    }
    throw err;
  }
};
