/**
 * Managed Memory Workflow provisioning (THINK-193 U3).
 *
 * Idempotent ensure of the user-owned Personal Memory Automation (one
 * personal processor per user + one agent_private workflow it points at)
 * and the operator-owned shared Memory Workflow (one shared processor per
 * Space/Tenant target + one tenant_shared workflow). The workflow's
 * definition is ALWAYS the code-owned blueprint, ensured lazily via
 * ensureMemoryBlueprintVersion — never hand-authored.
 *
 * Concurrency: the processor's partial-unique active-target index and the
 * workflows tenant/slug unique index resolve double-ensures; the
 * processor.workflow_id link is claimed with a workflow_id IS NULL CAS.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { ensureMemoryBlueprintVersion } from "@thinkwork/database-pg";
import {
  agentLoops,
  agentLoopVersions,
  memoryProcessorConfigs,
  memorySourceConfigs,
  workflowRuns,
  workflows as workflowsTable,
} from "@thinkwork/database-pg/schema";

import type {
  DbHandle,
  MemoryProcessorConfig,
  MemorySourceConfig,
} from "./types.js";
import { assertTargetInTenant, MemoryScopeError } from "./repository.js";

type WorkflowRow = typeof workflowsTable.$inferSelect;

export interface EnsuredMemoryAutomation {
  processor: MemoryProcessorConfig;
  workflow: WorkflowRow | null;
  sources: MemorySourceConfig[];
  /** True when either row was created by THIS call. */
  created: boolean;
}

/** Deterministic per-target slug so concurrent creates conflict cleanly. */
function memoryWorkflowSlug(
  mode: "personal" | "shared",
  targetScope: string,
  targetId: string,
): string {
  const base =
    mode === "personal" ? "personal-memory" : `memory-${targetScope}`;
  return `${base}-${targetId.replace(/-/g, "").slice(0, 10)}`;
}

async function findActiveProcessor(
  db: DbHandle,
  args: {
    tenantId: string;
    mode: "personal" | "shared";
    targetScope: "user" | "space" | "tenant";
    targetId: string;
  },
): Promise<MemoryProcessorConfig | null> {
  const [row] = await db
    .select()
    .from(memoryProcessorConfigs)
    .where(
      and(
        eq(memoryProcessorConfigs.tenant_id, args.tenantId),
        eq(memoryProcessorConfigs.mode, args.mode),
        eq(memoryProcessorConfigs.target_scope, args.targetScope),
        eq(memoryProcessorConfigs.target_id, args.targetId),
        eq(memoryProcessorConfigs.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function ensureProcessor(
  db: DbHandle,
  args: {
    tenantId: string;
    mode: "personal" | "shared";
    targetScope: "user" | "space" | "tenant";
    targetId: string;
    createdByUserId: string | null;
  },
): Promise<{ processor: MemoryProcessorConfig; created: boolean }> {
  const existing = await findActiveProcessor(db, args);
  if (existing) return { processor: existing, created: false };

  const [inserted] = await db
    .insert(memoryProcessorConfigs)
    .values({
      tenant_id: args.tenantId,
      mode: args.mode,
      target_scope: args.targetScope,
      target_id: args.targetId,
      enabled: true,
      status: "active",
      created_by_user_id: args.createdByUserId,
    })
    // Partial unique (tenant, mode, target_scope, target_id) WHERE active:
    // a concurrent ensure loses harmlessly and re-reads the winner.
    .onConflictDoNothing()
    .returning();
  if (inserted) return { processor: inserted, created: true };
  const winner = await findActiveProcessor(db, args);
  if (!winner) {
    throw new Error(
      `memory processor for ${args.mode}/${args.targetScope}/${args.targetId} vanished between insert and read`,
    );
  }
  return { processor: winner, created: false };
}

async function ensureWorkflowLink(
  db: DbHandle,
  args: {
    tenantId: string;
    processor: MemoryProcessorConfig;
    mode: "personal" | "shared";
    name: string;
    description: string;
    ownerUserId: string | null;
  },
): Promise<{ workflow: WorkflowRow; created: boolean }> {
  const loadWorkflow = async (id: string): Promise<WorkflowRow | null> => {
    const [row] = await db
      .select()
      .from(workflowsTable)
      .where(eq(workflowsTable.id, id))
      .limit(1);
    return row ?? null;
  };

  if (args.processor.workflow_id) {
    const existing = await loadWorkflow(args.processor.workflow_id);
    if (existing) return { workflow: existing, created: false };
    // FK is ON DELETE SET NULL, so a dangling id should not happen; treat a
    // missing row as "recreate".
  }

  const slug = memoryWorkflowSlug(
    args.mode,
    args.processor.target_scope,
    args.processor.target_id,
  );
  let workflow: WorkflowRow | null = null;
  let created = false;
  const [inserted] = await db
    .insert(workflowsTable)
    .values({
      tenant_id: args.tenantId,
      name: args.name,
      slug,
      description: args.description,
      lifecycle_status: "active",
      visibility: args.mode === "personal" ? "agent_private" : "tenant_shared",
      owner_user_id: args.ownerUserId,
      primary_trigger_family: "manual",
    })
    // (tenant_id, slug) unique: the concurrent creator wins; re-read below.
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    workflow = inserted;
    created = true;
  } else {
    const [existing] = await db
      .select()
      .from(workflowsTable)
      .where(
        and(
          eq(workflowsTable.tenant_id, args.tenantId),
          eq(workflowsTable.slug, slug),
        ),
      )
      .limit(1);
    workflow = existing ?? null;
  }
  if (!workflow) {
    throw new Error(
      `memory workflow '${slug}' could not be created or found for tenant ${args.tenantId}`,
    );
  }

  // Claim the link with a NULL-CAS so two ensures cannot bind two workflows.
  const claimed = await db
    .update(memoryProcessorConfigs)
    .set({ workflow_id: workflow.id, updated_at: new Date() })
    .where(
      and(
        eq(memoryProcessorConfigs.id, args.processor.id),
        isNull(memoryProcessorConfigs.workflow_id),
      ),
    )
    .returning({ workflow_id: memoryProcessorConfigs.workflow_id });
  if (claimed.length === 0) {
    // Lost the CAS (or the link already existed): the stored link wins.
    const [row] = await db
      .select({ workflow_id: memoryProcessorConfigs.workflow_id })
      .from(memoryProcessorConfigs)
      .where(eq(memoryProcessorConfigs.id, args.processor.id))
      .limit(1);
    if (row?.workflow_id && row.workflow_id !== workflow.id) {
      const linked = await loadWorkflow(row.workflow_id);
      if (linked) return { workflow: linked, created: false };
    }
  }
  return { workflow, created };
}

async function listSources(
  db: DbHandle,
  processorConfigId: string,
): Promise<MemorySourceConfig[]> {
  return await db
    .select()
    .from(memorySourceConfigs)
    .where(eq(memorySourceConfigs.processor_config_id, processorConfigId))
    .orderBy(memorySourceConfigs.created_at, memorySourceConfigs.id);
}

/** The system Automation key for a user's Personal Memory Processing. */
export const PERSONAL_MEMORY_SYSTEM_KEY = "personal-memory";

/**
 * THINK-264: give the managed memory workflow a first-class Automation
 * identity so it renders as a row in the Automations inventory — with a real
 * Definition and real Executions — instead of a bespoke card.
 *
 * agent_loops is the source and workflows the projection (workflows carry
 * source_agent_loop_id as provenance), so a memory workflow with no loop is
 * the odd one out. This backfills the missing side of that link. The loop is
 * `kind: 'system'`: never hand-created, never deletable, but enable/disable
 * flows through to the processor.
 *
 * Idempotent and concurrency-safe: (tenant_id, system_key, owner_user_id) is
 * partial-unique, so a double-ensure conflicts and the loser adopts the winner.
 */
async function ensureSystemMemoryAgentLoop(
  db: DbHandle,
  args: {
    tenantId: string;
    userId: string;
    processor: MemoryProcessorConfig;
    workflow: WorkflowRow | null;
  },
): Promise<void> {
  const { tenantId, userId, processor, workflow } = args;
  if (!workflow) return;

  const now = new Date();
  const triggerFamily =
    workflow.primary_trigger_family === "schedule" ? "schedule" : "manual";

  const readLoop = async () => {
    const [row] = await db
      .select()
      .from(agentLoops)
      .where(
        and(
          eq(agentLoops.tenant_id, tenantId),
          eq(agentLoops.system_key, PERSONAL_MEMORY_SYSTEM_KEY),
          eq(agentLoops.owner_user_id, userId),
        ),
      )
      .limit(1);
    return row ?? null;
  };

  let loop = await readLoop();
  if (!loop) {
    const inserted = await db
      .insert(agentLoops)
      .values({
        tenant_id: tenantId,
        name: workflow.name,
        // Reuse the workflow's per-user slug: already unique per tenant.
        slug: workflow.slug,
        description: workflow.description,
        kind: "system",
        system_key: PERSONAL_MEMORY_SYSTEM_KEY,
        lifecycle_status: "active",
        enabled: processor.enabled,
        owner_user_id: userId,
        run_as_user_id: userId,
        primary_trigger_family: triggerFamily,
      })
      .onConflictDoNothing()
      .returning();
    loop = inserted[0] ?? (await readLoop());
    if (!loop) return;
  }

  // The definition graph reads target_spec to know this is a memory pipeline
  // and which processor's stages to render.
  const targetSpec = {
    kind: "memory_pipeline",
    processorConfigId: processor.id,
    mode: processor.mode,
    workflowId: workflow.id,
  };

  if (!loop.current_version_id) {
    const [version] = await db
      .insert(agentLoopVersions)
      .values({
        tenant_id: tenantId,
        agent_loop_id: loop.id,
        version_number: 1,
        version_status: "active",
        trigger_spec: {
          family: triggerFamily,
          enabled: processor.enabled,
          config: {},
        } as never,
        target_spec: targetSpec,
        source_metadata: { systemKey: PERSONAL_MEMORY_SYSTEM_KEY },
        published_at: now,
      })
      .returning({ id: agentLoopVersions.id });
    if (version) {
      await db
        .update(agentLoops)
        .set({
          current_version_id: version.id,
          current_version_number: 1,
          updated_at: now,
        })
        .where(eq(agentLoops.id, loop.id));
    }
  }

  // Claim the provenance link so AgentLoop.linkedWorkflow resolves — this is
  // what makes the Executions tab show real memory runs.
  if (workflow.source_agent_loop_id !== loop.id) {
    await db
      .update(workflowsTable)
      .set({ source_agent_loop_id: loop.id, updated_at: now })
      .where(eq(workflowsTable.id, workflow.id));
  }

  // Mirror live state onto the row the inventory renders: the trigger family
  // and enablement are owned by the workflow/processor, and the Last run column
  // reads the loop's own columns.
  const [lastRun] = await db
    .select({
      id: workflowRuns.id,
      status: workflowRuns.status,
      created_at: workflowRuns.created_at,
    })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflow_id, workflow.id))
    .orderBy(desc(workflowRuns.created_at))
    .limit(1);

  await db
    .update(agentLoops)
    .set({
      name: workflow.name,
      enabled: processor.enabled,
      primary_trigger_family: triggerFamily,
      last_run_id: lastRun?.id ?? null,
      last_run_status: lastRun?.status ?? null,
      last_run_at: lastRun?.created_at ?? null,
      updated_at: now,
    })
    .where(eq(agentLoops.id, loop.id));
}

/**
 * Idempotent ensure of the caller's Personal Memory Automation: personal
 * processor (target_scope user, target_id = the user) + owned agent_private
 * workflow (owner_user_id set, manual trigger family) + current personal
 * blueprint version + the system Automation row it renders as. Safe to call
 * from the configuration-read path.
 */
export async function ensurePersonalMemoryAutomation(
  db: DbHandle,
  args: { tenantId: string; userId: string },
): Promise<EnsuredMemoryAutomation> {
  const { processor, created: processorCreated } = await ensureProcessor(db, {
    tenantId: args.tenantId,
    mode: "personal",
    targetScope: "user",
    targetId: args.userId,
    createdByUserId: args.userId,
  });
  const { workflow, created: workflowCreated } = await ensureWorkflowLink(db, {
    tenantId: args.tenantId,
    processor,
    mode: "personal",
    name: "Personal Memory Processing",
    description:
      "Platform-managed personal memory automation: process Thread memory plus optional bounded external sources into your private memory bank.",
    ownerUserId: args.userId,
  });
  await ensureMemoryBlueprintVersion(db, {
    tenantId: args.tenantId,
    workflowId: workflow.id,
  });
  const fresh = await findActiveProcessor(db, {
    tenantId: args.tenantId,
    mode: "personal",
    targetScope: "user",
    targetId: args.userId,
  });
  const effective = fresh ?? processor;
  await ensureSystemMemoryAgentLoop(db, {
    tenantId: args.tenantId,
    userId: args.userId,
    processor: effective,
    workflow,
  });
  return {
    processor: effective,
    workflow,
    sources: await listSources(db, processor.id),
    created: processorCreated || workflowCreated,
  };
}

/**
 * Operator-only ensure of a shared Memory Workflow for one Space/Tenant
 * target. The caller MUST have asserted tenant-admin before invoking; this
 * validates the target actually belongs to the tenant (R11).
 */
export async function ensureSharedMemoryWorkflow(
  db: DbHandle,
  args: {
    tenantId: string;
    targetScope: "space" | "tenant";
    targetId: string;
    actorUserId: string | null;
  },
): Promise<EnsuredMemoryAutomation> {
  const { processor, created: processorCreated } = await ensureProcessor(db, {
    tenantId: args.tenantId,
    mode: "shared",
    targetScope: args.targetScope,
    targetId: args.targetId,
    createdByUserId: args.actorUserId,
  });
  try {
    await assertTargetInTenant(db, processor);
  } catch (err) {
    if (err instanceof MemoryScopeError && processorCreated) {
      // Never leave a mis-targeted processor behind.
      await db
        .update(memoryProcessorConfigs)
        .set({ status: "disabled", enabled: false, updated_at: new Date() })
        .where(eq(memoryProcessorConfigs.id, processor.id));
    }
    throw err;
  }
  const { workflow, created: workflowCreated } = await ensureWorkflowLink(db, {
    tenantId: args.tenantId,
    processor,
    mode: "shared",
    name:
      args.targetScope === "tenant"
        ? "Company Memory Workflow"
        : "Space Memory Workflow",
    description:
      "Platform-managed shared memory workflow: reads only explicitly shared sources and writes only its configured shared bank.",
    ownerUserId: args.actorUserId,
  });
  await ensureMemoryBlueprintVersion(db, {
    tenantId: args.tenantId,
    workflowId: workflow.id,
  });
  const fresh = await findActiveProcessor(db, {
    tenantId: args.tenantId,
    mode: "shared",
    targetScope: args.targetScope,
    targetId: args.targetId,
  });
  return {
    processor: fresh ?? processor,
    workflow,
    sources: await listSources(db, processor.id),
    created: processorCreated || workflowCreated,
  };
}
