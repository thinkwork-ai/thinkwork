import { getConfig } from "@thinkwork/runtime-config";
import type { MemoryAdapter } from "../memory/adapter.js";
import { CogneeAdapter } from "../memory/adapters/cognee-adapter.js";
import { HindsightAdapter } from "../memory/adapters/hindsight-adapter.js";
import { resolveCogneeEndpoint } from "../memory/config.js";
import {
  maybeEnqueuePostTurnCompile,
  type PostTurnCompileResult,
} from "../wiki/enqueue.js";

export const REQUESTER_THREAD_DIGEST_CONTEXT =
  "thinkwork_requester_thread_digest";

export type RequesterThreadDigestRetainResult = {
  status: "upserted" | "skipped" | "failed";
  documentId: string;
  compileEnqueue?: PostTurnCompileResult;
  error?: string;
};

export type RetainRequesterThreadMemoryDigestInput = {
  tenantId: string;
  userId: string;
  runId: string;
  threadId: string;
  digestMarkdown: string;
  evidenceMessageIds: string[];
  metadata?: Record<string, unknown>;
};

export type RetainRequesterThreadMemoryDigestDeps = {
  adapter?: Pick<MemoryAdapter, "kind" | "upsertMarkdownMemoryDocument"> | null;
  enqueueCompile?: (input: {
    tenantId: string;
    ownerId: string;
    adapterKind: string;
  }) => Promise<PostTurnCompileResult>;
};

export async function retainRequesterThreadMemoryDigest(
  input: RetainRequesterThreadMemoryDigestInput,
  deps: RetainRequesterThreadMemoryDigestDeps = {},
): Promise<RequesterThreadDigestRetainResult> {
  const documentId = requesterThreadDigestDocumentId(
    input.userId,
    input.threadId,
  );
  const adapter = deps.adapter ?? createDefaultMemoryDocumentAdapter();

  if (!adapter?.upsertMarkdownMemoryDocument) {
    return {
      status: "skipped",
      documentId,
      error: "memory document adapter is not configured",
    };
  }

  try {
    await adapter.upsertMarkdownMemoryDocument({
      tenantId: input.tenantId,
      ownerType: "user",
      ownerId: input.userId,
      path: `memory/thread-digests/${input.threadId}.md`,
      content: input.digestMarkdown,
      documentId,
      context: REQUESTER_THREAD_DIGEST_CONTEXT,
      async: false,
      metadata: {
        ...(input.metadata ?? {}),
        runId: input.runId,
        threadId: input.threadId,
        evidenceMessageIds: input.evidenceMessageIds,
        source: "requester_thread_digest",
        sourceContext: REQUESTER_THREAD_DIGEST_CONTEXT,
      },
    });
  } catch (err) {
    return {
      status: "failed",
      documentId,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const enqueueCompile =
    deps.enqueueCompile ??
    ((args: { tenantId: string; ownerId: string; adapterKind: string }) =>
      maybeEnqueuePostTurnCompile(args));
  const compileEnqueue = await enqueueCompile({
    tenantId: input.tenantId,
    ownerId: input.userId,
    adapterKind: adapter.kind,
  }).catch(
    (err): PostTurnCompileResult => ({
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    }),
  );

  return {
    status: "upserted",
    documentId,
    compileEnqueue,
  };
}

export function requesterThreadDigestDocumentId(
  userId: string,
  threadId: string,
): string {
  return `requester_thread_digest:${userId}:${threadId}`;
}

// Memoized per container: the adapter carries the configured-banks cache, so
// per-call construction would re-pay the bank-config GET on every upsert.
let defaultAdapter:
  | Pick<MemoryAdapter, "kind" | "upsertMarkdownMemoryDocument">
  | null
  | undefined;

function createDefaultMemoryDocumentAdapter(): Pick<
  MemoryAdapter,
  "kind" | "upsertMarkdownMemoryDocument"
> | null {
  if (defaultAdapter !== undefined) return defaultAdapter;
  const engine = getConfig("MEMORY_ENGINE") || "hindsight";
  if (engine === "hindsight") {
    const endpoint = getConfig("HINDSIGHT_ENDPOINT") || "";
    defaultAdapter = endpoint ? new HindsightAdapter({ endpoint }) : null;
    return defaultAdapter;
  }
  if (engine === "cognee") {
    const endpoint = resolveCogneeEndpoint() || "";
    defaultAdapter = endpoint ? new CogneeAdapter({ endpoint }) : null;
    return defaultAdapter;
  }
  defaultAdapter = null;
  return defaultAdapter;
}
