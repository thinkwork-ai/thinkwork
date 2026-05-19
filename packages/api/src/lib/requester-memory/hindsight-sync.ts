import type { MemoryAdapter } from "../memory/adapter.js";
import { HindsightAdapter } from "../memory/adapters/hindsight-adapter.js";
import {
  readRequesterMemoryFile,
  type ChangedRequesterMemoryFile,
} from "./storage.js";

const DATE_PATH_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

export type RequesterMemoryHindsightSyncFile = {
  path: string;
  documentId: string;
  status: "upserted" | "skipped" | "failed";
  error?: string;
};

export type RequesterMemoryHindsightSyncResult = {
  status: "success" | "skipped" | "failed";
  files: RequesterMemoryHindsightSyncFile[];
  error?: string;
};

export type SyncRequesterMemoryToHindsightInput = {
  tenantId: string;
  userId: string;
  runId: string;
  threadId: string;
  changedFiles: ChangedRequesterMemoryFile[];
  adapter?: Pick<MemoryAdapter, "upsertMarkdownMemoryDocument">;
};

export async function syncRequesterMemoryToHindsight(
  input: SyncRequesterMemoryToHindsightInput,
): Promise<RequesterMemoryHindsightSyncResult> {
  const syncable = input.changedFiles.filter((file) =>
    isHindsightSyncableRequesterMemoryPath(file.path),
  );
  if (syncable.length === 0) {
    return { status: "skipped", files: [] };
  }

  const adapter = input.adapter ?? createDefaultHindsightAdapter();
  if (!adapter?.upsertMarkdownMemoryDocument) {
    return {
      status: "skipped",
      files: syncable.map((file) => ({
        path: file.path,
        documentId: requesterMemoryDocumentId(input.userId, file.path),
        status: "skipped",
        error: "hindsight adapter is not configured",
      })),
    };
  }

  const files: RequesterMemoryHindsightSyncFile[] = [];
  for (const file of syncable) {
    const documentId = requesterMemoryDocumentId(input.userId, file.path);
    try {
      const content = await readRequesterMemoryFile({
        tenantId: input.tenantId,
        userId: input.userId,
        path: file.path,
      });
      await adapter.upsertMarkdownMemoryDocument({
        tenantId: input.tenantId,
        ownerType: "user",
        ownerId: input.userId,
        path: file.path,
        content: content ?? "",
        documentId,
        context: "thinkwork_requester_memory",
        metadata: {
          runId: input.runId,
          threadId: input.threadId,
          beforeHash: file.beforeHash,
          afterHash: file.afterHash,
          beforeBytes: file.beforeBytes,
          afterBytes: file.afterBytes,
          snapshotKey: file.snapshotKey,
          evidenceMessageIds: file.evidenceMessageIds ?? [],
        },
      });
      files.push({ path: file.path, documentId, status: "upserted" });
    } catch (err) {
      files.push({
        path: file.path,
        documentId,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const failures = files.filter((file) => file.status === "failed");
  if (failures.length > 0) {
    return {
      status: "failed",
      files,
      error: `${failures.length} requester memory document sync(s) failed`,
    };
  }
  return { status: "success", files };
}

export function requesterMemoryDocumentId(
  userId: string,
  path: string,
): string {
  return `requester_memory:${userId}:${path}`;
}

export function isHindsightSyncableRequesterMemoryPath(path: string): boolean {
  if (path === "memory/MEMORY.md") return true;
  if (path === "memory/DREAMS.md") return true;
  const [root, collection, filename, extra] = path.split("/");
  return (
    root === "memory" &&
    collection === "working" &&
    Boolean(filename) &&
    !extra &&
    DATE_PATH_RE.test(filename)
  );
}

function createDefaultHindsightAdapter(): Pick<
  MemoryAdapter,
  "upsertMarkdownMemoryDocument"
> | null {
  if ((process.env.MEMORY_ENGINE || "hindsight") !== "hindsight") return null;
  const endpoint = process.env.HINDSIGHT_ENDPOINT || "";
  if (!endpoint) return null;
  return new HindsightAdapter({ endpoint });
}
