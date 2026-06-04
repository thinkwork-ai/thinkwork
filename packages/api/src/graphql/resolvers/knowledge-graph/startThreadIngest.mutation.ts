import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  assertCanReadKnowledgeGraphThread,
  resolveKnowledgeGraphScope,
} from "./auth.js";
import { serializeIngestRun } from "./mappers.js";
import {
  createKnowledgeGraphThreadIngestRun,
  markKnowledgeGraphRunInvokeFailed,
} from "../../../lib/knowledge-graph/runs.js";
import { invokeKnowledgeGraphThreadIngestWorker } from "../../../lib/knowledge-graph/invoke-worker.js";

interface StartKnowledgeGraphThreadIngestArgs {
  input: {
    tenantId?: string | null;
    threadId: string;
    force?: boolean | null;
    metadata?: string | Record<string, unknown> | null;
  };
}

export async function startKnowledgeGraphThreadIngest(
  _parent: unknown,
  args: StartKnowledgeGraphThreadIngestArgs,
  ctx: GraphQLContext,
) {
  const input = args.input;
  if (!input?.threadId) {
    throw new GraphQLError("threadId is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const scope = await resolveKnowledgeGraphScope(
    ctx,
    { tenantId: input.tenantId },
    "knowledge_graph_thread_ingest",
  );
  if (!(await assertCanReadKnowledgeGraphThread(ctx, scope, input.threadId))) {
    throw new GraphQLError("Thread not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  const { run, inserted } = await createKnowledgeGraphThreadIngestRun({
    db: ctx.db,
    tenantId: scope.tenantId,
    threadId: input.threadId,
    requestedByUserId: scope.callerUserId,
    force: input.force,
    metadata: input.metadata,
  });

  if (!inserted) {
    return serializeIngestRun(run);
  }

  try {
    await invokeKnowledgeGraphThreadIngestWorker({
      runId: run.id,
      tenantId: scope.tenantId,
      threadId: input.threadId,
      requestedByUserId: scope.callerUserId,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    const failed =
      (await markKnowledgeGraphRunInvokeFailed({
        db: ctx.db,
        runId: run.id,
        error: message,
      })) ?? run;
    throw new GraphQLError(
      `Knowledge Graph ingest worker invoke failed: ${message}`,
      {
        extensions: {
          code: "INTERNAL_SERVER_ERROR",
          run: serializeIngestRun(failed),
        },
      },
    );
  }

  return serializeIngestRun(run);
}
