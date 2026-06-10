import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { resolveKnowledgeGraphScope } from "./auth.js";
import { serializeIngestRun } from "./mappers.js";
import {
  createKnowledgeGraphObservationsIngestRun,
  markKnowledgeGraphRunInvokeFailed,
} from "../../../lib/knowledge-graph/runs.js";
import { invokeKnowledgeGraphObservationsIngestWorker } from "../../../lib/knowledge-graph/invoke-worker.js";

interface StartKnowledgeGraphObservationsIngestArgs {
  input?: {
    tenantId?: string | null;
    fullRebuild?: boolean | null;
    metadata?: string | Record<string, unknown> | null;
  } | null;
}

export async function startKnowledgeGraphObservationsIngest(
  _parent: unknown,
  args: StartKnowledgeGraphObservationsIngestArgs,
  ctx: GraphQLContext,
) {
  const input = args.input ?? {};
  const scope = await resolveKnowledgeGraphScope(
    ctx,
    { tenantId: input.tenantId },
    "knowledge_graph_observations_ingest",
  );

  const { run, inserted } = await createKnowledgeGraphObservationsIngestRun({
    db: ctx.db,
    tenantId: scope.tenantId,
    requestedByUserId: scope.callerUserId,
    trigger: "manual",
    fullRebuild: input.fullRebuild,
    metadata: input.metadata,
  });

  if (!inserted) {
    return serializeIngestRun(run);
  }

  try {
    await invokeKnowledgeGraphObservationsIngestWorker({
      runId: run.id,
      tenantId: scope.tenantId,
      fullRebuild: input.fullRebuild === true,
      trigger: "manual",
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
