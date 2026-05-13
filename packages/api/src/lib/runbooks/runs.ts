import { createHash } from "crypto";
import { GraphQLError } from "graphql";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  computerRunbookRuns,
  computerRunbookTasks,
  computers,
  tenantRunbookCatalog,
  type RunbookInvocationMode,
  type RunbookRunStatus,
} from "@thinkwork/database-pg/schema";
import type { RunbookDefinition } from "./definition.js";
import {
  assertExpandedTasksReferenceDeclaredPhases,
  expandRunbookTasks,
} from "./tasks.js";

const db = getDb();

export type RunbookRunRow = typeof computerRunbookRuns.$inferSelect;
export type RunbookTaskRow = typeof computerRunbookTasks.$inferSelect;

export class RunbookRunTransitionError extends Error {
  constructor(
    message: string,
    public readonly code = "BAD_USER_INPUT",
  ) {
    super(message);
    this.name = "RunbookRunTransitionError";
  }
}

export function buildRunbookRunRecords(input: {
  tenantId: string;
  computerId: string;
  catalogId?: string | null;
  threadId?: string | null;
  selectedByMessageId?: string | null;
  runbook: RunbookDefinition;
  invocationMode?: RunbookInvocationMode;
  inputs?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
}) {
  const tasks = expandRunbookTasks(input.runbook);
  assertExpandedTasksReferenceDeclaredPhases(input.runbook, tasks);

  return {
    run: {
      tenant_id: input.tenantId,
      computer_id: input.computerId,
      catalog_id: input.catalogId ?? null,
      thread_id: input.threadId ?? null,
      selected_by_message_id: input.selectedByMessageId ?? null,
      runbook_slug: input.runbook.slug,
      runbook_version: input.runbook.version,
      status: "awaiting_confirmation" as RunbookRunStatus,
      invocation_mode: input.invocationMode ?? "auto",
      definition_snapshot: buildRunbookDefinitionSnapshot(input.runbook),
      inputs: input.inputs ?? {},
      idempotency_key: input.idempotencyKey ?? null,
    },
    tasks: tasks.map((task) => ({
      tenant_id: input.tenantId,
      run_id: "",
      phase_id: task.phaseId,
      phase_title: task.phaseTitle,
      task_key: task.taskKey,
      title: task.title,
      summary: task.summary,
      depends_on: task.dependsOn,
      capability_roles: task.capabilityRoles,
      sort_order: task.sortOrder,
      details: task.details,
    })),
  };
}

export function buildRunbookDefinitionSnapshot(
  runbook: RunbookDefinition,
): Record<string, unknown> {
  const snapshot = jsonClone(runbook);
  const skill = recordValue((runbook as { skill?: unknown }).skill);
  if (!skill) return snapshot;

  const skillMd = stringValue(skill.skillMd);
  const contract = recordValue(skill.contract) ?? {};
  const contractJson = stableJson(contract);
  snapshot.skill = {
    slug: stringValue(skill.slug) || runbook.slug,
    source: stringValue(skill.source) || "template-workspace",
    skillMdPath: stringValue(skill.skillMdPath) || "SKILL.md",
    skillMd,
    skillMdSha256: sha256(skillMd),
    skillBody: stringValue(skill.skillBody),
    frontmatter: recordValue(skill.frontmatter) ?? {},
    contractPath:
      stringValue(skill.contractPath) || "references/thinkwork-runbook.json",
    contract,
    contractSha256: sha256(contractJson),
    assetRefs: collectAssetRefs(contract),
  };
  return snapshot;
}

export async function createRunbookRun(input: {
  tenantId: string;
  computerId: string;
  catalogId?: string | null;
  threadId?: string | null;
  selectedByMessageId?: string | null;
  runbook: RunbookDefinition;
  invocationMode?: RunbookInvocationMode;
  inputs?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
}) {
  await requireComputer(input.tenantId, input.computerId);
  if (input.catalogId) {
    await requireCatalogItem(input.tenantId, input.catalogId);
  }

  if (input.idempotencyKey) {
    const existing = await findRunByIdempotencyKey({
      tenantId: input.tenantId,
      computerId: input.computerId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) return existing;
  }

  const records = buildRunbookRunRecords(input);
  const run = await db.transaction(async (tx) => {
    const [createdRun] = await tx
      .insert(computerRunbookRuns)
      .values(records.run)
      .returning();
    const taskRows = records.tasks.map((task) => ({
      ...task,
      run_id: createdRun.id,
    }));
    if (taskRows.length > 0) {
      await tx.insert(computerRunbookTasks).values(taskRows);
    }
    return createdRun;
  });

  return getRunbookRun({
    tenantId: input.tenantId,
    runId: run.id,
  });
}

export async function getRunbookRun(input: {
  tenantId: string;
  runId: string;
}) {
  const [run] = await db
    .select()
    .from(computerRunbookRuns)
    .where(
      and(
        eq(computerRunbookRuns.tenant_id, input.tenantId),
        eq(computerRunbookRuns.id, input.runId),
      ),
    )
    .limit(1);
  if (!run) return null;
  const tasks = await listRunbookTasks(input);
  return toGraphqlRunbookRun(run, tasks);
}

export async function listRunbookRuns(input: {
  tenantId: string;
  computerId: string;
  threadId?: string | null;
  status?: RunbookRunStatus | null;
  limit?: number | null;
}) {
  await requireComputer(input.tenantId, input.computerId);
  const conditions = [
    eq(computerRunbookRuns.tenant_id, input.tenantId),
    eq(computerRunbookRuns.computer_id, input.computerId),
  ];
  if (input.threadId) {
    conditions.push(eq(computerRunbookRuns.thread_id, input.threadId));
  }
  if (input.status) {
    conditions.push(eq(computerRunbookRuns.status, input.status));
  }
  const runs = await db
    .select()
    .from(computerRunbookRuns)
    .where(and(...conditions))
    .orderBy(desc(computerRunbookRuns.created_at))
    .limit(Math.min(Math.max(input.limit ?? 25, 1), 100));

  const result = [];
  for (const run of runs) {
    const tasks = await listRunbookTasks({
      tenantId: input.tenantId,
      runId: run.id,
    });
    result.push(toGraphqlRunbookRun(run, tasks));
  }
  return result;
}

export async function confirmRunbookRun(input: {
  tenantId: string;
  runId: string;
  userId?: string | null;
}) {
  const run = await requireRun(input.tenantId, input.runId);
  const transition = transitionRunbookRunStatus(run.status, "confirm");
  if (transition.idempotent) {
    return getRunbookRun({ tenantId: input.tenantId, runId: input.runId });
  }
  const [updated] = await db
    .update(computerRunbookRuns)
    .set({
      status: transition.status,
      approved_by_user_id: input.userId ?? null,
      approved_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(computerRunbookRuns.tenant_id, input.tenantId),
        eq(computerRunbookRuns.id, input.runId),
        eq(computerRunbookRuns.status, "awaiting_confirmation"),
      ),
    )
    .returning();
  if (!updated) {
    return getRunbookRun({ tenantId: input.tenantId, runId: input.runId });
  }
  return getRunbookRun({ tenantId: input.tenantId, runId: input.runId });
}

export async function markRunbookRunRunning(input: {
  tenantId: string;
  runId: string;
}) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(computerRunbookRuns)
      .set({
        status: "running",
        started_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(computerRunbookRuns.tenant_id, input.tenantId),
          eq(computerRunbookRuns.id, input.runId),
          inArray(computerRunbookRuns.status, ["queued", "running"]),
        ),
      );

    const [activeTask] = await tx
      .select({ id: computerRunbookTasks.id })
      .from(computerRunbookTasks)
      .where(
        and(
          eq(computerRunbookTasks.tenant_id, input.tenantId),
          eq(computerRunbookTasks.run_id, input.runId),
          eq(computerRunbookTasks.status, "running"),
        ),
      )
      .limit(1);
    if (activeTask) return;

    const [firstPendingTask] = await tx
      .select({ id: computerRunbookTasks.id })
      .from(computerRunbookTasks)
      .where(
        and(
          eq(computerRunbookTasks.tenant_id, input.tenantId),
          eq(computerRunbookTasks.run_id, input.runId),
          eq(computerRunbookTasks.status, "pending"),
        ),
      )
      .orderBy(asc(computerRunbookTasks.sort_order))
      .limit(1);
    if (!firstPendingTask) return;

    await tx
      .update(computerRunbookTasks)
      .set({
        status: "running",
        started_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(computerRunbookTasks.tenant_id, input.tenantId),
          eq(computerRunbookTasks.id, firstPendingTask.id),
          eq(computerRunbookTasks.status, "pending"),
        ),
      );
  });
  return getRunbookRun({ tenantId: input.tenantId, runId: input.runId });
}

export async function completeRunbookRunFromThreadTurn(input: {
  tenantId: string;
  runId: string;
  output?: unknown;
}) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(computerRunbookTasks)
      .set({
        status: "completed",
        output: input.output ?? null,
        completed_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(computerRunbookTasks.tenant_id, input.tenantId),
          eq(computerRunbookTasks.run_id, input.runId),
          inArray(computerRunbookTasks.status, ["pending", "running"]),
        ),
      );
    await tx
      .update(computerRunbookRuns)
      .set({
        status: "completed",
        output: input.output ?? null,
        completed_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(computerRunbookRuns.tenant_id, input.tenantId),
          eq(computerRunbookRuns.id, input.runId),
          inArray(computerRunbookRuns.status, ["queued", "running"]),
        ),
      );
  });
  return getRunbookRun({ tenantId: input.tenantId, runId: input.runId });
}

export async function failRunbookRunFromThreadTurn(input: {
  tenantId: string;
  runId: string;
  error: unknown;
}) {
  const now = new Date();
  const error = input.error ?? { message: "Runbook run failed" };
  await db.transaction(async (tx) => {
    const runningTasks = await tx
      .select({ id: computerRunbookTasks.id })
      .from(computerRunbookTasks)
      .where(
        and(
          eq(computerRunbookTasks.tenant_id, input.tenantId),
          eq(computerRunbookTasks.run_id, input.runId),
          eq(computerRunbookTasks.status, "running"),
        ),
      )
      .orderBy(asc(computerRunbookTasks.sort_order));
    const failedTaskIds = runningTasks.map((task) => task.id);

    if (failedTaskIds.length === 0) {
      const [firstPendingTask] = await tx
        .select({ id: computerRunbookTasks.id })
        .from(computerRunbookTasks)
        .where(
          and(
            eq(computerRunbookTasks.tenant_id, input.tenantId),
            eq(computerRunbookTasks.run_id, input.runId),
            eq(computerRunbookTasks.status, "pending"),
          ),
        )
        .orderBy(asc(computerRunbookTasks.sort_order))
        .limit(1);
      if (firstPendingTask) failedTaskIds.push(firstPendingTask.id);
    }

    if (failedTaskIds.length > 0) {
      await tx
        .update(computerRunbookTasks)
        .set({
          status: "failed",
          error,
          completed_at: now,
          updated_at: now,
        })
        .where(
          and(
            eq(computerRunbookTasks.tenant_id, input.tenantId),
            eq(computerRunbookTasks.run_id, input.runId),
            inArray(computerRunbookTasks.id, failedTaskIds),
          ),
        );
    }

    await tx
      .update(computerRunbookTasks)
      .set({
        status: "skipped",
        completed_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(computerRunbookTasks.tenant_id, input.tenantId),
          eq(computerRunbookTasks.run_id, input.runId),
          eq(computerRunbookTasks.status, "pending"),
        ),
      );
    await tx
      .update(computerRunbookRuns)
      .set({
        status: "failed",
        error,
        completed_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(computerRunbookRuns.tenant_id, input.tenantId),
          eq(computerRunbookRuns.id, input.runId),
          inArray(computerRunbookRuns.status, ["queued", "running"]),
        ),
      );
  });
  return getRunbookRun({ tenantId: input.tenantId, runId: input.runId });
}

export async function rejectRunbookRun(input: {
  tenantId: string;
  runId: string;
  userId?: string | null;
}) {
  const run = await requireRun(input.tenantId, input.runId);
  const transition = transitionRunbookRunStatus(run.status, "reject");
  const [updated] = await db
    .update(computerRunbookRuns)
    .set({
      status: transition.status,
      rejected_by_user_id: input.userId ?? null,
      rejected_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(computerRunbookRuns.tenant_id, input.tenantId),
        eq(computerRunbookRuns.id, input.runId),
        eq(computerRunbookRuns.status, "awaiting_confirmation"),
      ),
    )
    .returning();
  if (!updated) throw staleTransitionError();
  return getRunbookRun({ tenantId: input.tenantId, runId: input.runId });
}

export async function cancelRunbookRun(input: {
  tenantId: string;
  runId: string;
  userId?: string | null;
}) {
  const run = await requireRun(input.tenantId, input.runId);
  const transition = transitionRunbookRunStatus(run.status, "cancel");
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(computerRunbookRuns)
      .set({
        status: transition.status,
        cancelled_by_user_id: input.userId ?? null,
        cancelled_at: new Date(),
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(computerRunbookRuns.tenant_id, input.tenantId),
          eq(computerRunbookRuns.id, input.runId),
          eq(computerRunbookRuns.status, run.status),
        ),
      )
      .returning();
    if (!updated) throw staleTransitionError();
    await tx
      .update(computerRunbookTasks)
      .set({ status: "cancelled", updated_at: new Date() })
      .where(
        and(
          eq(computerRunbookTasks.tenant_id, input.tenantId),
          eq(computerRunbookTasks.run_id, input.runId),
          inArray(computerRunbookTasks.status, ["pending", "running"]),
        ),
      );
  });
  return getRunbookRun({ tenantId: input.tenantId, runId: input.runId });
}

export function transitionRunbookRunStatus(
  current: string,
  event: "confirm" | "reject" | "cancel",
): { status: RunbookRunStatus; idempotent?: boolean } {
  if (event === "confirm") {
    if (current === "awaiting_confirmation") return { status: "queued" };
    if (current === "queued") return { status: "queued", idempotent: true };
    throw new RunbookRunTransitionError(
      `Cannot confirm runbook run in ${current} status`,
    );
  }

  if (event === "reject") {
    if (current === "awaiting_confirmation") return { status: "rejected" };
    throw new RunbookRunTransitionError(
      `Cannot reject runbook run in ${current} status`,
    );
  }

  if (
    current === "awaiting_confirmation" ||
    current === "queued" ||
    current === "running"
  ) {
    return { status: "cancelled" };
  }
  throw new RunbookRunTransitionError(
    `Cannot cancel runbook run in ${current} status`,
  );
}

export function parseRunbookRunStatus(
  value: unknown,
): RunbookRunStatus | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).toLowerCase();
  if (
    normalized === "awaiting_confirmation" ||
    normalized === "queued" ||
    normalized === "running" ||
    normalized === "completed" ||
    normalized === "failed" ||
    normalized === "cancelled" ||
    normalized === "rejected"
  ) {
    return normalized;
  }
  throw new GraphQLError(`Invalid Runbook run status: ${String(value)}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export function toGraphqlRunbookRun(
  row: RunbookRunRow,
  tasks: ReturnType<typeof toGraphqlRunbookTask>[],
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    computerId: row.computer_id,
    threadId: row.thread_id ?? null,
    catalogId: row.catalog_id ?? null,
    runbookSlug: row.runbook_slug,
    runbookVersion: row.runbook_version,
    status: enumToGraphql(row.status),
    invocationMode: enumToGraphql(row.invocation_mode),
    selectedByMessageId: row.selected_by_message_id ?? null,
    approvedByUserId: row.approved_by_user_id ?? null,
    rejectedByUserId: row.rejected_by_user_id ?? null,
    cancelledByUserId: row.cancelled_by_user_id ?? null,
    definitionSnapshot: row.definition_snapshot,
    inputs: row.inputs,
    output: row.output ?? null,
    error: row.error ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    approvedAt: row.approved_at ?? null,
    rejectedAt: row.rejected_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tasks,
  };
}

export function toGraphqlRunbookTask(row: RunbookTaskRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    runId: row.run_id,
    phaseId: row.phase_id,
    phaseTitle: row.phase_title,
    taskKey: row.task_key,
    title: row.title,
    summary: row.summary ?? null,
    status: enumToGraphql(row.status),
    dependsOn: row.depends_on,
    capabilityRoles: row.capability_roles,
    sortOrder: row.sort_order,
    details: row.details ?? null,
    output: row.output ?? null,
    error: row.error ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listRunbookTasks(input: { tenantId: string; runId: string }) {
  const rows = await db
    .select()
    .from(computerRunbookTasks)
    .where(
      and(
        eq(computerRunbookTasks.tenant_id, input.tenantId),
        eq(computerRunbookTasks.run_id, input.runId),
      ),
    )
    .orderBy(asc(computerRunbookTasks.sort_order));
  return rows.map(toGraphqlRunbookTask);
}

async function requireRun(tenantId: string, runId: string) {
  const [run] = await db
    .select()
    .from(computerRunbookRuns)
    .where(
      and(
        eq(computerRunbookRuns.tenant_id, tenantId),
        eq(computerRunbookRuns.id, runId),
      ),
    )
    .limit(1);
  if (!run) {
    throw new GraphQLError("Runbook run not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return run;
}

async function requireComputer(tenantId: string, computerId: string) {
  const [computer] = await db
    .select({ id: computers.id })
    .from(computers)
    .where(and(eq(computers.tenant_id, tenantId), eq(computers.id, computerId)))
    .limit(1);
  if (!computer) {
    throw new GraphQLError("Computer not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
}

async function requireCatalogItem(tenantId: string, catalogId: string) {
  const [catalogItem] = await db
    .select({ id: tenantRunbookCatalog.id })
    .from(tenantRunbookCatalog)
    .where(
      and(
        eq(tenantRunbookCatalog.tenant_id, tenantId),
        eq(tenantRunbookCatalog.id, catalogId),
      ),
    )
    .limit(1);
  if (!catalogItem) {
    throw new GraphQLError("Runbook catalog item not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
}

async function findRunByIdempotencyKey(input: {
  tenantId: string;
  computerId: string;
  idempotencyKey: string;
}) {
  const [run] = await db
    .select()
    .from(computerRunbookRuns)
    .where(
      and(
        eq(computerRunbookRuns.tenant_id, input.tenantId),
        eq(computerRunbookRuns.computer_id, input.computerId),
        eq(computerRunbookRuns.idempotency_key, input.idempotencyKey),
      ),
    )
    .orderBy(asc(computerRunbookRuns.created_at))
    .limit(1);
  if (!run) return null;
  return getRunbookRun({ tenantId: input.tenantId, runId: run.id });
}

function staleTransitionError() {
  return new RunbookRunTransitionError(
    "Runbook run status changed before the transition completed",
    "CONFLICT",
  );
}

function jsonClone(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function collectAssetRefs(contract: Record<string, unknown>) {
  const refs = new Set<string>();
  const assets = contract.assets;
  if (Array.isArray(assets)) {
    for (const asset of assets) {
      if (typeof asset === "string" && asset.trim()) refs.add(asset);
    }
  }

  const outputs = contract.outputs;
  if (Array.isArray(outputs)) {
    for (const output of outputs) {
      const record = recordValue(output);
      const asset = record ? stringValue(record.asset) : "";
      if (asset) refs.add(asset);
    }
  }
  return [...refs].sort();
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function enumToGraphql(value: string) {
  return value.toUpperCase();
}
