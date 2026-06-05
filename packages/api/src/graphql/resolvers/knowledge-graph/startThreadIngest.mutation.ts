import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  assertCanReadKnowledgeGraphThread,
  resolveKnowledgeGraphScope,
} from "./auth.js";
import { serializeIngestRun } from "./mappers.js";
import {
  createKnowledgeGraphThreadIngestRun,
  createKnowledgeGraphIngestRun,
  markKnowledgeGraphRunInvokeFailed,
} from "../../../lib/knowledge-graph/runs.js";
import { invokeKnowledgeGraphThreadIngestWorker } from "../../../lib/knowledge-graph/invoke-worker.js";
import { toDbEnum } from "./mappers.js";

interface StartKnowledgeGraphThreadIngestArgs {
  input: {
    tenantId?: string | null;
    threadId: string;
    force?: boolean | null;
    metadata?: string | Record<string, unknown> | null;
  };
}

interface StartKnowledgeGraphIngestArgs {
  input: {
    tenantId?: string | null;
    sourceKind: "THREAD" | "WIKI" | "BRAIN";
    threadId?: string | null;
    sourceRef?: string | null;
    sourceLabel?: string | null;
    ownerUserId?: string | null;
    pageIds?: string[] | null;
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
      sourceKind: "thread",
      sourceRef: input.threadId,
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

export async function startKnowledgeGraphIngest(
  _parent: unknown,
  args: StartKnowledgeGraphIngestArgs,
  ctx: GraphQLContext,
) {
  const input = args.input;
  const sourceKind = toDbEnum(input?.sourceKind) as "thread" | "wiki" | "brain";
  if (!["thread", "wiki", "brain"].includes(sourceKind)) {
    throw new GraphQLError("sourceKind is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const scope = await resolveKnowledgeGraphScope(
    ctx,
    { tenantId: input.tenantId },
    sourceKind === "thread"
      ? "knowledge_graph_thread_ingest"
      : "knowledge_graph_source_ingest",
  );

  if (sourceKind === "thread") {
    if (!input.threadId) {
      throw new GraphQLError("threadId is required for thread ingest", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    if (
      !(await assertCanReadKnowledgeGraphThread(ctx, scope, input.threadId))
    ) {
      throw new GraphQLError("Thread not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }
  }

  const ownerUserId =
    sourceKind === "wiki" ? (input.ownerUserId ?? scope.callerUserId) : null;
  if (sourceKind === "wiki" && !ownerUserId) {
    throw new GraphQLError("ownerUserId is required for wiki ingest", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const { run, inserted } = await createKnowledgeGraphIngestRun({
    db: ctx.db,
    tenantId: scope.tenantId,
    sourceKind,
    threadId: input.threadId,
    sourceRef: input.sourceRef,
    sourceLabel: input.sourceLabel,
    ownerUserId,
    pageIds: input.pageIds,
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
      threadId: run.thread_id ?? undefined,
      sourceKind,
      sourceRef: run.source_ref,
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
