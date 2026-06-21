import { GraphQLError } from "graphql";
import {
  createAnalyticsDisplayGenUIValidationContext,
  stableStringify,
  validateThreadGenUIPart,
  type ThreadGenUIPart,
} from "@thinkwork/genui";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  artifacts,
  db,
  eq,
  messages,
  randomUUID,
  sql,
  threads,
} from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "../threads/access.js";
import {
  artifactToCamelWithPayload,
  persistArtifactContentPayload,
} from "./payload.js";

const SNAPSHOT_SCHEMA_VERSION = "thread-genui-artifact-snapshot/v1";
const SNAPSHOT_KIND = "genui_snapshot";

export const promoteGenUIArtifact = async (
  _parent: unknown,
  args: { input?: PromoteGenUIArtifactInput },
  ctx: GraphQLContext,
) => {
  const input = parseInput(args.input);
  const caller = await resolveCallerFromAuth(ctx.auth);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  await requireTenantMember(ctx, caller.tenantId);

  const source = await loadValidatedSourcePart({
    tenantId: caller.tenantId,
    userId: caller.userId,
    input,
  });

  const duplicate = await findDuplicatePromotion({
    tenantId: caller.tenantId,
    threadId: input.threadId,
    idempotencyKey: input.idempotencyKey,
  });
  if (duplicate) return artifactToCamelWithPayload(duplicate);

  const id = randomUUID();
  const promotedAt = new Date().toISOString();
  const snapshot = buildSnapshotPayload({
    part: source.part,
    input,
    promotedAt,
    promotedByUserId: caller.userId,
  });
  const content = stableStringify(snapshot);
  const contentS3Key = await persistArtifactContentPayload({
    tenantId: caller.tenantId,
    artifactId: id,
    content,
    type: "data_view",
    contentType: "application/json; charset=utf-8",
  });
  const metadata = buildArtifactMetadata({
    part: source.part,
    input,
    promotedAt,
    promotedByUserId: caller.userId,
  });

  const [row] = await db
    .insert(artifacts)
    .values({
      id,
      tenant_id: caller.tenantId,
      agent_id: source.thread.agent_id ?? null,
      thread_id: input.threadId,
      title: artifactTitle(source.part),
      type: "data_view",
      status: "final",
      content: contentS3Key ? null : content,
      s3_key: contentS3Key,
      summary: artifactSummary(source.part),
      source_message_id: input.sourceMessageId,
      metadata,
    })
    .returning();
  return artifactToCamelWithPayload(row);
};

interface PromoteGenUIArtifactInput {
  threadId: string;
  sourceMessageId: string;
  partId: string;
  specHash: string;
  idempotencyKey: string;
}

function parseInput(input: PromoteGenUIArtifactInput | undefined) {
  if (!input) {
    throw new GraphQLError("Generated UI promotion input is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const parsed: PromoteGenUIArtifactInput = {
    threadId: requiredString(input.threadId, "threadId"),
    sourceMessageId: requiredString(input.sourceMessageId, "sourceMessageId"),
    partId: requiredString(input.partId, "partId"),
    specHash: requiredString(input.specHash, "specHash"),
    idempotencyKey: requiredString(input.idempotencyKey, "idempotencyKey"),
  };
  if (parsed.idempotencyKey.length > 160) {
    throw new GraphQLError("Generated UI promotion idempotency key is too long", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return parsed;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GraphQLError(`Generated UI promotion ${field} is required`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return value.trim();
}

async function loadValidatedSourcePart(input: {
  tenantId: string;
  userId: string;
  input: PromoteGenUIArtifactInput;
}): Promise<{
  thread: { id: string; agent_id: string | null };
  part: ThreadGenUIPart;
}> {
  const [visibleThread] = await db
    .select({ id: threads.id, agent_id: threads.agent_id })
    .from(threads)
    .where(
      and(
        eq(threads.id, input.input.threadId),
        eq(threads.tenant_id, input.tenantId),
        callerVisibleThreadPredicate(input.tenantId, input.userId),
      ),
    );
  if (!visibleThread) {
    throw new GraphQLError("Thread does not belong to requester", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  const [sourceMessage] = await db
    .select({
      id: messages.id,
      thread_id: messages.thread_id,
      tenant_id: messages.tenant_id,
      role: messages.role,
      parts: messages.parts,
    })
    .from(messages)
    .where(eq(messages.id, input.input.sourceMessageId));
  if (
    !sourceMessage ||
    sourceMessage.tenant_id !== input.tenantId ||
    sourceMessage.thread_id !== input.input.threadId
  ) {
    throw new GraphQLError("Generated UI source message was not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  if (sourceMessage.role !== "assistant") {
    throw new GraphQLError(
      "Generated UI promotion must come from assistant UI",
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  const rawPart = findSourcePart(sourceMessage.parts, input.input.partId);
  if (!rawPart) {
    throw new GraphQLError("Generated UI source part was not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  const validation = validateThreadGenUIPart(
    rawPart,
    createAnalyticsDisplayGenUIValidationContext(),
  );
  if (!validation.ok) {
    throw new GraphQLError("Generated UI source part is invalid", {
      extensions: {
        code: "BAD_USER_INPUT",
        diagnostics: validation.diagnostics,
      },
    });
  }
  if (validation.part.data.status !== "ready") {
    throw new GraphQLError("Generated UI source part is not ready", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  if (validation.part.data.specHash !== input.input.specHash) {
    throw new GraphQLError("Generated UI promotion is stale", {
      extensions: { code: "CONFLICT" },
    });
  }

  return { thread: visibleThread, part: validation.part };
}

function findSourcePart(parts: unknown, partId: string): unknown {
  const parsed = parseJson(parts);
  if (!Array.isArray(parsed)) return null;
  return parsed.find(
    (part) =>
      isRecord(part) && part.type === "data-genui" && part.id === partId,
  );
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function findDuplicatePromotion(input: {
  tenantId: string;
  threadId: string;
  idempotencyKey: string;
}) {
  const [duplicate] = await db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.tenant_id, input.tenantId),
        eq(artifacts.thread_id, input.threadId),
        sql`${artifacts.metadata}->>'kind' = ${SNAPSHOT_KIND}`,
        sql`${artifacts.metadata}->'genuiSnapshot'->>'idempotencyKey' = ${input.idempotencyKey}`,
      ),
    )
    .limit(1);
  return duplicate ?? null;
}

function buildSnapshotPayload(input: {
  part: ThreadGenUIPart;
  input: PromoteGenUIArtifactInput;
  promotedAt: string;
  promotedByUserId: string;
}) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: SNAPSHOT_KIND,
    source: {
      threadId: input.input.threadId,
      sourceMessageId: input.input.sourceMessageId,
      partId: input.input.partId,
      specHash: input.input.specHash,
      schemaVersion: input.part.data.schemaVersion,
      catalogVersion: input.part.data.catalogVersion,
      promotedAt: input.promotedAt,
      promotedByUserId: input.promotedByUserId,
    },
    genui: input.part,
  };
}

function buildArtifactMetadata(input: {
  part: ThreadGenUIPart;
  input: PromoteGenUIArtifactInput;
  promotedAt: string;
  promotedByUserId: string;
}) {
  return {
    kind: SNAPSHOT_KIND,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    genuiSnapshot: {
      sourceMessageId: input.input.sourceMessageId,
      partId: input.input.partId,
      specHash: input.input.specHash,
      schemaVersion: input.part.data.schemaVersion,
      catalogVersion: input.part.data.catalogVersion,
      promotedAt: input.promotedAt,
      promotedByUserId: input.promotedByUserId,
      idempotencyKey: input.input.idempotencyKey,
    },
  };
}

function artifactTitle(part: ThreadGenUIPart): string {
  return boundedText(
    part.data.promotion?.artifactTitle ||
      part.data.mobileFallback.title ||
      "Generated UI snapshot",
    160,
  );
}

function artifactSummary(part: ThreadGenUIPart): string {
  return boundedText(
    part.data.promotion?.artifactSummary ||
      part.data.mobileFallback.summary ||
      "Snapshot of a generated Thread UI.",
    500,
  );
}

function boundedText(value: string, max: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max - 1).trimEnd() + "...";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
