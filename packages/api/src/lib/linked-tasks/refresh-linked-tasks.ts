import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { linkedTasks } from "@thinkwork/database-pg/schema";

import type {
  LastMileAdapterResult,
  LastMileTaskSnapshot,
} from "../lastmile/tasks-adapter.js";
import {
  markLinkedTaskSyncFailure,
  syncLinkedTaskFromProviderEvent,
  type LinkedTaskSyncRepository,
} from "./sync-linked-task.js";

export interface LinkedTaskRefreshCandidate {
  tenantId: string;
  threadId: string;
  externalTaskId: string;
}

export interface LinkedTaskRefreshRepository {
  listCandidates(input: {
    tenantId: string;
    threadId?: string | null;
    externalTaskIds?: string[] | null;
    limit: number;
  }): Promise<LinkedTaskRefreshCandidate[]>;
}

export interface LastMileTaskRefreshAdapter {
  readTask(input: {
    externalTaskId: string;
  }): Promise<LastMileAdapterResult<LastMileTaskSnapshot>>;
}

export interface RefreshLinkedTasksInput {
  tenantId: string;
  threadId?: string | null;
  externalTaskIds?: string[] | null;
  limit?: number | null;
}

export interface RefreshLinkedTasksDeps {
  refreshRepository?: LinkedTaskRefreshRepository;
  syncRepository?: LinkedTaskSyncRepository;
  taskAdapter: LastMileTaskRefreshAdapter;
  now?: () => Date;
}

export interface RefreshLinkedTasksResult {
  checked: number;
  updated: number;
  failed: number;
  skipped: number;
}

export async function refreshLinkedTasks(
  input: RefreshLinkedTasksInput,
  deps: RefreshLinkedTasksDeps,
): Promise<RefreshLinkedTasksResult> {
  const repository =
    deps.refreshRepository ?? new DrizzleLinkedTaskRefreshRepository();
  const candidates = await repository.listCandidates({
    tenantId: input.tenantId,
    threadId: input.threadId,
    externalTaskIds: input.externalTaskIds,
    limit: input.limit ?? 100,
  });
  const result: RefreshLinkedTasksResult = {
    checked: candidates.length,
    updated: 0,
    failed: 0,
    skipped: 0,
  };

  for (const candidate of candidates) {
    const read = await deps.taskAdapter.readTask({
      externalTaskId: candidate.externalTaskId,
    });
    if (!read.ok) {
      result.failed += 1;
      await markLinkedTaskSyncFailure(
        {
          tenantId: input.tenantId,
          externalTaskId: candidate.externalTaskId,
          message: read.providerError.message,
          code: read.providerError.code,
          raw: read.providerError.detail,
        },
        { repository: deps.syncRepository, now: deps.now },
      );
      continue;
    }

    const synced = await syncLinkedTaskFromProviderEvent(
      {
        tenantId: input.tenantId,
        externalTaskId: candidate.externalTaskId,
        eventName: "task.refresh",
        status: read.value.status,
        blocked: read.value.blocked,
        title: read.value.title,
        externalTaskUrl: read.value.externalTaskUrl,
        assignee: read.value.assignee,
        dueAt: read.value.dueAt,
        raw: read.value.raw,
      },
      { repository: deps.syncRepository, now: deps.now },
    );
    if (synced.skipped) {
      result.skipped += 1;
    } else {
      result.updated += 1;
    }
  }

  return result;
}

class DrizzleLinkedTaskRefreshRepository
  implements LinkedTaskRefreshRepository
{
  private readonly db = getDb();

  async listCandidates(input: {
    tenantId: string;
    threadId?: string | null;
    externalTaskIds?: string[] | null;
    limit: number;
  }): Promise<LinkedTaskRefreshCandidate[]> {
    const predicates = [
      eq(linkedTasks.tenant_id, input.tenantId),
      eq(linkedTasks.provider, "lastmile"),
      isNotNull(linkedTasks.external_task_id),
    ];
    if (input.threadId) {
      predicates.push(eq(linkedTasks.thread_id, input.threadId));
    }
    if (input.externalTaskIds?.length) {
      predicates.push(
        inArray(linkedTasks.external_task_id, input.externalTaskIds),
      );
    }

    const rows = await this.db
      .select({
        tenantId: linkedTasks.tenant_id,
        threadId: linkedTasks.thread_id,
        externalTaskId: linkedTasks.external_task_id,
      })
      .from(linkedTasks)
      .where(and(...predicates))
      .limit(input.limit);

    return rows.map((row) => ({
      tenantId: row.tenantId,
      threadId: row.threadId,
      externalTaskId: row.externalTaskId,
    }));
  }
}
