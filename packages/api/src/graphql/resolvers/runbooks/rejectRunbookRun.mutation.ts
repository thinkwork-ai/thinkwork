import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  rejectRunbookRun as rejectRunbookRunState,
  RunbookRunTransitionError,
} from "../../../lib/runbooks/runs.js";
import { requireRunbookRunAccess, resolveRunbookCaller } from "./shared.js";

export async function rejectRunbookRun(
  _parent: any,
  args: { id: string },
  ctx: GraphQLContext,
) {
  const { tenantId, userId } = await resolveRunbookCaller(ctx);
  await requireRunbookRunAccess(ctx, tenantId, args.id);
  try {
    return await rejectRunbookRunState({
      tenantId,
      runId: args.id,
      userId,
    });
  } catch (error) {
    throw mapRunbookRunError(error);
  }
}

function mapRunbookRunError(error: unknown) {
  if (error instanceof RunbookRunTransitionError) {
    return new GraphQLError(error.message, {
      extensions: { code: error.code },
    });
  }
  return error;
}
