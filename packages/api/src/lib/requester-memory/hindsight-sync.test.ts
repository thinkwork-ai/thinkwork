import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isHindsightSyncableRequesterMemoryPath,
  requesterMemoryDocumentId,
  syncRequesterMemoryToHindsight,
} from "./hindsight-sync.js";
import type { ChangedRequesterMemoryFile } from "./storage.js";

const s3Mock = mockClient(S3Client);

const changedMemoryFile: ChangedRequesterMemoryFile = {
  path: "memory/MEMORY.md",
  key: "tenants/tenant-1/users/user-1/memory/MEMORY.md",
  beforeHash: "before",
  afterHash: "after",
  beforeBytes: 10,
  afterBytes: 20,
  snapshotKey:
    "tenants/tenant-1/users/user-1/memory/.snapshots/run-1/memory.md",
  evidenceMessageIds: ["msg-1"],
};

function s3Body(content: string) {
  return {
    Body: {
      transformToString: async () => content,
    },
  } as any;
}

describe("requester memory Hindsight sync", () => {
  beforeEach(() => {
    s3Mock.reset();
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
  });

  it("uses a stable requester memory document id for repeated updates", () => {
    expect(requesterMemoryDocumentId("user-1", "memory/MEMORY.md")).toBe(
      "requester_memory:user-1:memory/MEMORY.md",
    );
    expect(requesterMemoryDocumentId("user-1", "memory/MEMORY.md")).toBe(
      requesterMemoryDocumentId("user-1", "memory/MEMORY.md"),
    );
  });

  it("ignores reports, snapshots, state, and staged candidate files", () => {
    expect(isHindsightSyncableRequesterMemoryPath("memory/MEMORY.md")).toBe(
      true,
    );
    expect(isHindsightSyncableRequesterMemoryPath("memory/DREAMS.md")).toBe(
      true,
    );
    expect(
      isHindsightSyncableRequesterMemoryPath("memory/working/2026-05-18.md"),
    ).toBe(true);
    expect(
      isHindsightSyncableRequesterMemoryPath("memory/candidates/2026-05-18.md"),
    ).toBe(false);
    expect(
      isHindsightSyncableRequesterMemoryPath(
        "memory/reports/thread-idle/run-1.md",
      ),
    ).toBe(false);
    expect(
      isHindsightSyncableRequesterMemoryPath("memory/.snapshots/run-1/file.md"),
    ).toBe(false);
    expect(
      isHindsightSyncableRequesterMemoryPath(
        "memory/.state/thread-idle/thread.json",
      ),
    ).toBe(false);
  });

  it("upserts durable requester memory markdown with provenance metadata", async () => {
    const upsertMarkdownMemoryDocument = vi.fn().mockResolvedValue(undefined);
    s3Mock.on(GetObjectCommand).resolves(s3Body("# Durable memory"));

    const result = await syncRequesterMemoryToHindsight({
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
      threadId: "thread-1",
      changedFiles: [changedMemoryFile],
      adapter: { upsertMarkdownMemoryDocument },
    });

    expect(result).toEqual({
      status: "success",
      files: [
        {
          path: "memory/MEMORY.md",
          documentId: "requester_memory:user-1:memory/MEMORY.md",
          status: "upserted",
        },
      ],
    });
    expect(upsertMarkdownMemoryDocument).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      ownerType: "user",
      ownerId: "user-1",
      path: "memory/MEMORY.md",
      content: "# Durable memory",
      documentId: "requester_memory:user-1:memory/MEMORY.md",
      context: "thinkwork_requester_memory",
      metadata: {
        runId: "run-1",
        threadId: "thread-1",
        beforeHash: "before",
        afterHash: "after",
        beforeBytes: 10,
        afterBytes: 20,
        snapshotKey:
          "tenants/tenant-1/users/user-1/memory/.snapshots/run-1/memory.md",
        evidenceMessageIds: ["msg-1"],
      },
    });
  });

  it("returns a failed sync result without throwing when Hindsight upsert fails", async () => {
    const upsertMarkdownMemoryDocument = vi
      .fn()
      .mockRejectedValue(new Error("hindsight unavailable"));
    s3Mock.on(GetObjectCommand).resolves(s3Body("# Durable memory"));

    const result = await syncRequesterMemoryToHindsight({
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
      threadId: "thread-1",
      changedFiles: [changedMemoryFile],
      adapter: { upsertMarkdownMemoryDocument },
    });

    expect(result.status).toBe("failed");
    expect(result.files[0]).toMatchObject({
      path: "memory/MEMORY.md",
      documentId: "requester_memory:user-1:memory/MEMORY.md",
      status: "failed",
      error: "hindsight unavailable",
    });
  });
});
