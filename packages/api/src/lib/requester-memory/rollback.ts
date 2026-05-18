import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { threadIdleLearningRuns } from "@thinkwork/database-pg/schema";
import type { MemoryAdapter } from "../memory/adapter.js";
import {
  syncRequesterMemoryToHindsight,
  type RequesterMemoryHindsightSyncResult,
} from "./hindsight-sync.js";
import {
  restoreRequesterMemorySnapshot,
  type ChangedRequesterMemoryFile,
} from "./storage.js";

const db = getDb();

export type RollbackRequesterIdleLearningRunInput = {
  tenantId: string;
  userId: string;
  runId: string;
  adapter?: Pick<MemoryAdapter, "upsertMarkdownMemoryDocument">;
};

export type RollbackRequesterIdleLearningRunResult = {
  run: ThreadIdleLearningRunRow;
  hindsightSync: RequesterMemoryHindsightSyncResult;
};

export type ThreadIdleLearningRunRow = {
  id: string;
  tenant_id: string;
  thread_id: string;
  computer_id: string | null;
  requester_user_id: string | null;
  scheduled_job_id: string | null;
  activity_sequence: number;
  scheduled_for: Date | null;
  started_at: Date;
  finished_at: Date | null;
  status: string;
  changed_files: unknown;
  candidate_summary: unknown;
  report_s3_key: string | null;
  error: string | null;
  budget: unknown;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
};

export async function rollbackRequesterIdleLearningRun(
  input: RollbackRequesterIdleLearningRunInput,
): Promise<RollbackRequesterIdleLearningRunResult> {
  const run = await loadRequesterIdleLearningRun(input);
  if (!run) {
    throw new Error("idle-learning run not found");
  }
  if (run.status === "rolled_back") {
    return {
      run,
      hindsightSync: {
        status: "skipped",
        files: [],
        error: "already rolled back",
      },
    };
  }

  const changedFiles = parseChangedFiles(run.changed_files);
  if (changedFiles.length === 0) {
    throw new Error("idle-learning run has no changed files to roll back");
  }

  for (const file of changedFiles) {
    await restoreRequesterMemorySnapshot({
      tenantId: input.tenantId,
      userId: input.userId,
      path: file.path,
      snapshotKey: file.snapshotKey ?? null,
    });
  }

  const hindsightSync = await syncRequesterMemoryToHindsight({
    tenantId: input.tenantId,
    userId: input.userId,
    runId: input.runId,
    threadId: run.thread_id,
    changedFiles,
    adapter: input.adapter,
  });

  const rollbackMetadata = {
    ...(isRecord(run.metadata) ? run.metadata : {}),
    rollback: {
      rolledBackAt: new Date().toISOString(),
      restoredFiles: changedFiles.map((file) => ({
        path: file.path,
        snapshotKey: file.snapshotKey ?? null,
      })),
      hindsightSync,
    },
  };

  const [updated] = await db
    .update(threadIdleLearningRuns)
    .set({
      status: "rolled_back",
      finished_at: new Date(),
      updated_at: new Date(),
      metadata: rollbackMetadata,
      error:
        hindsightSync.status === "failed"
          ? (hindsightSync.error ??
            "requester memory rollback Hindsight sync failed")
          : run.error,
    })
    .where(
      and(
        eq(threadIdleLearningRuns.id, input.runId),
        eq(threadIdleLearningRuns.tenant_id, input.tenantId),
        eq(threadIdleLearningRuns.requester_user_id, input.userId),
      ),
    )
    .returning();

  return {
    run: (updated ?? run) as ThreadIdleLearningRunRow,
    hindsightSync,
  };
}

export async function loadRequesterIdleLearningRun(input: {
  tenantId: string;
  userId: string;
  runId: string;
}): Promise<ThreadIdleLearningRunRow | null> {
  const [run] = await db
    .select()
    .from(threadIdleLearningRuns)
    .where(
      and(
        eq(threadIdleLearningRuns.id, input.runId),
        eq(threadIdleLearningRuns.tenant_id, input.tenantId),
        eq(threadIdleLearningRuns.requester_user_id, input.userId),
      ),
    )
    .limit(1);
  return (run as ThreadIdleLearningRunRow | undefined) ?? null;
}

export function parseChangedFiles(
  value: unknown,
): ChangedRequesterMemoryFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((file) => ({
      path: typeof file.path === "string" ? file.path : "",
      key: typeof file.key === "string" ? file.key : "",
      beforeHash: typeof file.beforeHash === "string" ? file.beforeHash : null,
      afterHash: typeof file.afterHash === "string" ? file.afterHash : "",
      beforeBytes: typeof file.beforeBytes === "number" ? file.beforeBytes : 0,
      afterBytes: typeof file.afterBytes === "number" ? file.afterBytes : 0,
      snapshotKey:
        typeof file.snapshotKey === "string" ? file.snapshotKey : null,
      evidenceMessageIds: Array.isArray(file.evidenceMessageIds)
        ? file.evidenceMessageIds.filter(
            (id): id is string => typeof id === "string",
          )
        : undefined,
      hindsightDocumentId:
        typeof file.hindsightDocumentId === "string"
          ? file.hindsightDocumentId
          : undefined,
      hindsightStatus:
        typeof file.hindsightStatus === "string"
          ? file.hindsightStatus
          : undefined,
    }))
    .filter((file) => file.path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
