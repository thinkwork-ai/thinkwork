import { getConfig } from "@thinkwork/runtime-config";
import type { MemoryAdapter } from "../memory/adapter.js";
import { HindsightAdapter } from "../memory/adapters/hindsight-adapter.js";

export const REQUESTER_THREAD_DIGEST_CONTEXT =
  "thinkwork_requester_thread_digest";

export type RequesterThreadDigestRetainResult = {
  status: "upserted" | "skipped" | "failed";
  documentId: string;
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
};

export async function retainRequesterThreadMemoryDigest(
  input: RetainRequesterThreadMemoryDigestInput,
  deps: RetainRequesterThreadMemoryDigestDeps = {},
): Promise<RequesterThreadDigestRetainResult> {
  const documentId = requesterThreadDigestDocumentId(
    input.userId,
    input.threadId,
  );
  const adapter = deps.adapter ?? createDefaultHindsightAdapter();

  if (!adapter?.upsertMarkdownMemoryDocument) {
    return {
      status: "skipped",
      documentId,
      error: "hindsight adapter is not configured",
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

  // No post-digest wiki-compile enqueue: retired at the U11 cutover (plan
  // 2026-06-09-004) — the wiki compiles from the knowledge-graph mirror
  // after each observations ingest run.
  return {
    status: "upserted",
    documentId,
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
let defaultAdapter: HindsightAdapter | null | undefined;

function createDefaultHindsightAdapter(): Pick<
  MemoryAdapter,
  "kind" | "upsertMarkdownMemoryDocument"
> | null {
  if (defaultAdapter !== undefined) return defaultAdapter;
  if ((getConfig("MEMORY_ENGINE") || "hindsight") !== "hindsight") {
    defaultAdapter = null;
    return null;
  }
  const endpoint = getConfig("HINDSIGHT_ENDPOINT") || "";
  defaultAdapter = endpoint ? new HindsightAdapter({ endpoint }) : null;
  return defaultAdapter;
}
