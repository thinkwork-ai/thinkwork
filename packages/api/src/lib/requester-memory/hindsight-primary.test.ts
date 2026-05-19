import { describe, expect, it, vi } from "vitest";
import {
  REQUESTER_THREAD_DIGEST_CONTEXT,
  requesterThreadDigestDocumentId,
  retainRequesterThreadMemoryDigest,
} from "./hindsight-primary.js";

const baseInput = {
  tenantId: "tenant-1",
  userId: "user-1",
  runId: "run-1",
  threadId: "thread-1",
  digestMarkdown:
    "# Requester Thread Memory Digest\n\n## Thread thread-1\n\n### Promoted Memory\n\n- [preference] Use concise summaries\n",
  evidenceMessageIds: ["msg-1"],
  metadata: {
    candidateSummary: { promoted: 1, staged: 0 },
  },
};

describe("requester thread digest Hindsight retain", () => {
  it("uses a stable requester thread digest document id", () => {
    expect(requesterThreadDigestDocumentId("user-1", "thread-1")).toBe(
      "requester_thread_digest:user-1:thread-1",
    );
    expect(requesterThreadDigestDocumentId("user-1", "thread-1")).toBe(
      requesterThreadDigestDocumentId("user-1", "thread-1"),
    );
  });

  it("upserts the processed digest and enqueues wiki compile", async () => {
    const upsertMarkdownMemoryDocument = vi.fn().mockResolvedValue(undefined);
    const enqueueCompile = vi
      .fn()
      .mockResolvedValue({ status: "enqueued", jobId: "compile-1" });

    const result = await retainRequesterThreadMemoryDigest(baseInput, {
      adapter: {
        kind: "hindsight",
        upsertMarkdownMemoryDocument,
      },
      enqueueCompile,
    });

    expect(result).toEqual({
      status: "upserted",
      documentId: "requester_thread_digest:user-1:thread-1",
      compileEnqueue: { status: "enqueued", jobId: "compile-1" },
    });
    expect(upsertMarkdownMemoryDocument).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      ownerType: "user",
      ownerId: "user-1",
      path: "memory/thread-digests/thread-1.md",
      content: baseInput.digestMarkdown,
      documentId: "requester_thread_digest:user-1:thread-1",
      context: REQUESTER_THREAD_DIGEST_CONTEXT,
      async: false,
      metadata: {
        candidateSummary: { promoted: 1, staged: 0 },
        runId: "run-1",
        threadId: "thread-1",
        evidenceMessageIds: ["msg-1"],
        source: "requester_thread_digest",
        sourceContext: REQUESTER_THREAD_DIGEST_CONTEXT,
      },
    });
    expect(enqueueCompile).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      ownerId: "user-1",
      adapterKind: "hindsight",
    });
  });

  it("reports adapter failure without throwing", async () => {
    const result = await retainRequesterThreadMemoryDigest(baseInput, {
      adapter: {
        kind: "hindsight",
        upsertMarkdownMemoryDocument: vi
          .fn()
          .mockRejectedValue(new Error("hindsight down")),
      },
      enqueueCompile: vi.fn(),
    });

    expect(result).toEqual({
      status: "failed",
      documentId: "requester_thread_digest:user-1:thread-1",
      error: "hindsight down",
    });
  });
});
