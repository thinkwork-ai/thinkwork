/**
 * connectKnowledgeBaseSource (external S3 KB source U4): map an existing
 * customer-owned S3 bucket/prefix as an s3-connect source of a KB.
 *
 * The kb-manager Lambda is invoked RequestResponse (KTD7) and performs the
 * as-role preflight (R8), source-row insert, and Bedrock CUSTOM data-source
 * creation; any failure propagates here and is surfaced to the operator with
 * the real reason (R9). The initial ingestion is NOT awaited — a Bedrock
 * sync can run for many minutes, far past the GraphQL timeout — the caller
 * follows up with syncKnowledgeBase and polls source status (CLI does this).
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, knowledgeBases, snakeToCamel } from "../../utils.js";
import { knowledgeBaseSources } from "@thinkwork/database-pg/schema";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { dispatchKbManagerSync } from "./kb-manager-dispatch.js";

interface ConnectInput {
  knowledgeBaseId: string;
  bucket: string;
  prefix: string;
  include?: string[] | null;
  exclude?: string[] | null;
  bucketOwnerAccountId?: string | null;
}

export const connectKnowledgeBaseSource = async (
  _parent: any,
  args: { input: ConnectInput },
  ctx: GraphQLContext,
) => {
  const input = args.input;

  // Authz: derive the tenant pin from the KB row, then gate.
  const [existing] = await db
    .select({ tenant_id: knowledgeBases.tenant_id })
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, input.knowledgeBaseId));
  if (!existing) throw new GraphQLError("Knowledge base not found");
  await requireAdminOrServiceCaller(
    ctx,
    existing.tenant_id,
    "connect_knowledge_base_source",
  );

  // Fast-fail validation; the manager re-validates (defense in depth).
  if (!input.bucket.trim() || !input.prefix.trim()) {
    throw new GraphQLError("bucket and prefix are required");
  }
  if ((input.include?.length ?? 0) > 25 || (input.exclude?.length ?? 0) > 25) {
    throw new GraphQLError(
      "At most 25 include and 25 exclude patterns are allowed",
    );
  }

  let result: { sourceId: string };
  try {
    result = await dispatchKbManagerSync<{ sourceId: string }>(
      "connect_source",
      input.knowledgeBaseId,
      {
        connect: {
          bucket: input.bucket.trim(),
          prefix: input.prefix.trim(),
          include: input.include ?? [],
          exclude: input.exclude ?? [],
          bucketOwnerAccountId: input.bucketOwnerAccountId ?? null,
        },
      },
    );
  } catch (err) {
    // Surface the manager's reason verbatim — "missing grant on role X" is
    // the whole point of the synchronous path (R9).
    throw new GraphQLError(err instanceof Error ? err.message : String(err));
  }

  const [source] = await db
    .select()
    .from(knowledgeBaseSources)
    .where(eq(knowledgeBaseSources.id, result.sourceId));
  if (!source) {
    throw new GraphQLError("Source row missing after connect");
  }
  const camel = snakeToCamel(source) as Record<string, unknown>;
  if (camel.filterPatterns != null) {
    camel.filterPatterns = JSON.stringify(camel.filterPatterns);
  }
  return camel;
};
