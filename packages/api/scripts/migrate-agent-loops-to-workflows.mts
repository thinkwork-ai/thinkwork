#!/usr/bin/env tsx
/**
 * THINK-216: migrate Automations (agent_loops) to canonical workflows.
 *
 * For every non-archived agent_loop with a dispatchable active version:
 *   1. upsert a workflow keyed on (tenant_id, source_agent_loop_id) with a
 *      published version whose definition_snapshot is the converted
 *      target_spec (workflowDefinitionFromAgentLoopVersion);
 *   2. repoint the loop's scheduled_jobs rows to trigger_type
 *      'workflow_schedule' + workflow_id (job-trigger's row-priority redirect
 *      handles the frozen EventBridge payloads);
 *   3. repoint the loop's webhook rows to target_type 'workflow' + workflow_id;
 *   4. import agent_loop_runs history into workflow_runs (idempotency key
 *      `agent-loop-import:<run id>`) with one engine_history event per
 *      iteration;
 *   5. archive the loop (lifecycle_status 'archived', enabled false) so the
 *      old dispatch path can never fire it again.
 *
 * Idempotent and re-runnable: workflows dedupe on source_agent_loop_id,
 * imported runs dedupe on their idempotency key, repoints are no-ops the
 * second time. Dry-run by default; pass --write to apply.
 *
 *   DATABASE_URL=... npx tsx scripts/migrate-agent-loops-to-workflows.ts [--write] [--tenant=<uuid>]
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agentLoopIterations,
  agentLoopRuns,
  agentLoopVersions,
  agentLoops,
  scheduledJobs,
  webhooks,
  workflowRunEvents,
  workflowRuns,
  workflowVersions,
  workflows,
} from "@thinkwork/database-pg/schema";
import {
  resolveDispatchableVersion,
  workflowDefinitionFromAgentLoopVersion,
  WORKFLOW_INTERPRETER_SOURCE_KIND,
} from "@thinkwork/agent-loops-core";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const tenantFilter = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--tenant="))
  ?.split("=")[1];

const db = getDb();

const RUN_STATUS_MAP: Record<string, string> = {
  completed: "succeeded",
  failed: "failed",
  budget_stopped: "failed",
  escalated: "failed",
  canceled: "canceled",
  skipped: "canceled",
  // Non-terminal old-path runs are closed out as canceled on import; the old
  // dispatch path is retired with the loop, so they can never finish.
  queued: "canceled",
  running: "canceled",
  waiting_for_human: "canceled",
};

async function main() {
  const loops = await db
    .select()
    .from(agentLoops)
    .where(
      and(
        ne(agentLoops.lifecycle_status, "archived"),
        ...(tenantFilter ? [eq(agentLoops.tenant_id, tenantFilter)] : []),
      ),
    );
  console.log(`${loops.length} non-archived agent_loops to migrate`);

  let migrated = 0;
  let skipped = 0;
  for (const loop of loops) {
    const label = `${loop.name ?? loop.id} (${loop.id})`;
    const [versionRow] = await db
      .select()
      .from(agentLoopVersions)
      .where(
        and(
          eq(agentLoopVersions.agent_loop_id, loop.id),
          eq(agentLoopVersions.version_status, "active"),
        ),
      )
      .orderBy(sql`${agentLoopVersions.created_at} DESC`)
      .limit(1);
    if (!versionRow) {
      console.warn(`SKIP ${label}: no active version`);
      skipped += 1;
      continue;
    }

    let definition;
    try {
      const dispatchable = resolveDispatchableVersion(versionRow as never);
      definition = workflowDefinitionFromAgentLoopVersion(dispatchable);
    } catch (err) {
      console.warn(`SKIP ${label}: ${(err as Error).message}`);
      skipped += 1;
      continue;
    }

    const triggerFamily = mapTriggerFamily(loop.primary_trigger_family);
    console.log(
      `${write ? "MIGRATE" : "DRY-RUN"} ${label}: ${definition.steps.map((s) => s.kind).join(" → ")} [${triggerFamily}]`,
    );
    if (!write) continue;

    const workflowId = await upsertWorkflow(loop, definition, triggerFamily);
    await repointScheduledJobs(loop.id, workflowId);
    await repointWebhooks(loop.id, workflowId);
    await importRunHistory(loop, workflowId);
    await db
      .update(agentLoops)
      .set({
        lifecycle_status: "archived",
        enabled: false,
        updated_at: new Date(),
      })
      .where(eq(agentLoops.id, loop.id));
    migrated += 1;
  }
  console.log(
    `done: ${migrated} migrated, ${skipped} skipped${write ? "" : " (dry run — pass --write to apply)"}`,
  );
}

function mapTriggerFamily(family: string | null): string {
  // workflows check constraint: manual|schedule|webhook|crm|n8n|api|agent|child_workflow.
  // agent_loops families map 1:1 except app_event, which has no workflow
  // equivalent yet — its schedule/webhook rows still repoint; manual is a
  // safe display default for the primary family.
  if (!family) return "manual";
  return ["manual", "schedule", "webhook", "api", "n8n"].includes(family)
    ? family
    : "manual";
}

async function upsertWorkflow(
  loop: typeof agentLoops.$inferSelect,
  definition: unknown,
  triggerFamily: string,
): Promise<string> {
  const [existing] = await db
    .select({
      id: workflows.id,
      current_version_id: workflows.current_version_id,
    })
    .from(workflows)
    .where(
      and(
        eq(workflows.tenant_id, loop.tenant_id),
        eq(workflows.source_agent_loop_id, loop.id),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [workflow] = await db
    .insert(workflows)
    .values({
      tenant_id: loop.tenant_id,
      name: loop.name ?? "Migrated automation",
      slug: `automation-${loop.id.slice(0, 8)}`,
      description:
        loop.description ?? "Migrated from an Automation (THINK-216).",
      lifecycle_status: "active",
      primary_trigger_family: triggerFamily,
      source_agent_loop_id: loop.id,
    })
    .returning({ id: workflows.id });

  const [version] = await db
    .insert(workflowVersions)
    .values({
      tenant_id: loop.tenant_id,
      workflow_id: workflow.id,
      version_number: 1,
      version_status: "active",
      source_kind: WORKFLOW_INTERPRETER_SOURCE_KIND,
      definition_snapshot: definition,
      published_at: new Date(),
    })
    .returning({ id: workflowVersions.id });

  await db
    .update(workflows)
    .set({ current_version_id: version.id, current_version_number: 1 })
    .where(eq(workflows.id, workflow.id));
  return workflow.id;
}

async function repointScheduledJobs(agentLoopId: string, workflowId: string) {
  const result = await db
    .update(scheduledJobs)
    .set({ trigger_type: "workflow_schedule", workflow_id: workflowId })
    .where(
      and(
        eq(scheduledJobs.agent_loop_id, agentLoopId),
        eq(scheduledJobs.trigger_type, "agent_loop_schedule"),
      ),
    )
    .returning({ id: scheduledJobs.id });
  if (result.length > 0) {
    console.log(`  repointed ${result.length} scheduled job(s)`);
  }
}

async function repointWebhooks(agentLoopId: string, workflowId: string) {
  const result = await db
    .update(webhooks)
    .set({ target_type: "workflow", workflow_id: workflowId })
    .where(eq(webhooks.agent_loop_id, agentLoopId))
    .returning({ id: webhooks.id });
  if (result.length > 0) {
    console.log(`  repointed ${result.length} webhook(s)`);
  }
}

async function importRunHistory(
  loop: typeof agentLoops.$inferSelect,
  workflowId: string,
) {
  const runs = await db
    .select()
    .from(agentLoopRuns)
    .where(eq(agentLoopRuns.agent_loop_id, loop.id));
  let imported = 0;
  for (const run of runs) {
    const idempotencyKey = `agent-loop-import:${run.id}`;
    const [inserted] = await db
      .insert(workflowRuns)
      .values({
        tenant_id: loop.tenant_id,
        workflow_id: workflowId,
        status: RUN_STATUS_MAP[run.status] ?? "canceled",
        trigger_family: run.trigger_family,
        trigger_source: run.trigger_source ?? "agent_loop_import",
        idempotency_key: idempotencyKey,
        actor_type: run.actor_type,
        actor_id: run.actor_id,
        correlation_id: run.correlation_id,
        input_summary: {
          ...(run.input_summary ?? {}),
          importedFromAgentLoopRunId: run.id,
        },
        capability_snapshot: { start: false, monitor: true },
        readiness_snapshot: { state: "imported", reasons: [] },
        started_at: run.started_at,
        finished_at: run.finished_at,
        last_event_at: run.finished_at ?? run.created_at,
        created_at: run.created_at,
      })
      .onConflictDoNothing({
        target: [workflowRuns.tenant_id, workflowRuns.idempotency_key],
        where: sql`${workflowRuns.idempotency_key} IS NOT NULL`,
      })
      .returning({ id: workflowRuns.id });
    if (!inserted) continue; // already imported

    const iterations = await db
      .select()
      .from(agentLoopIterations)
      .where(eq(agentLoopIterations.agent_loop_run_id, run.id));
    for (const iteration of iterations) {
      await db.insert(workflowRunEvents).values({
        tenant_id: loop.tenant_id,
        workflow_run_id: inserted.id,
        event_type:
          iteration.status === "completed"
            ? "workflow_step_finished"
            : "workflow_step_failed",
        event_status: iteration.status,
        provenance: "engine_history",
        occurred_at: iteration.finished_at ?? iteration.created_at,
        message: "Imported from the Automation run ledger (THINK-216).",
        payload_summary: {
          stepId: "work",
          stepKind: "agent",
          iteration: iteration.iteration_number,
          status: iteration.status,
          importedFromIterationId: iteration.id,
        },
        created_at: iteration.created_at,
      });
    }
    imported += 1;
  }
  if (imported > 0) console.log(`  imported ${imported}/${runs.length} run(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
