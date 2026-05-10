import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  confirmRunbookRun as confirmRunbookRunState,
  RunbookRunTransitionError,
} from "../../../lib/runbooks/runs.js";
import { queueConfirmedRunbookRun } from "../../../lib/computers/thread-cutover.js";
import { requireRunbookRunAccess, resolveRunbookCaller } from "./shared.js";

export async function confirmRunbookRun(
  _parent: any,
  args: { id: string },
  ctx: GraphQLContext,
) {
  const { tenantId, userId } = await resolveRunbookCaller(ctx);
  await requireRunbookRunAccess(ctx, tenantId, args.id);
  try {
    const run = await confirmRunbookRunState({
      tenantId,
      runId: args.id,
      userId,
    });
    if (run?.threadId) {
      await queueConfirmedRunbookRun({
        tenantId,
        computerId: run.computerId,
        threadId: run.threadId,
        runbookRunId: run.id,
        sourceMessageId: run.selectedByMessageId ?? run.id,
        actorType: "user",
        actorId: userId,
      });
    }
    return run;
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
