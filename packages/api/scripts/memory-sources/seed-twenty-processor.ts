/**
 * Seed the U1 Twenty proving-slice processor + Memory Workflow (THINK-193).
 *
 * Operator/dev tooling for the U1 dogfood: creates (idempotently, by slug /
 * unique target) the shared memory processor config, its Twenty source
 * config, and a canonical Workflow whose definition is the four-stage
 * memory_stage pipeline acquire → project → retain → compound. Optionally
 * triggers a run. The product configuration surfaces arrive in U3 — this
 * script is a thin seam over the same reusable substrate, not a control
 * plane.
 *
 * Usage (from packages/api, with dev DATABASE_URL + AWS creds exported):
 *   npx tsx scripts/memory-sources/seed-twenty-processor.ts \
 *     --tenant <tenantId> --user <ownerUserId> \
 *     --scope tenant --target <tenantId> [--max-records 25] [--run]
 */

import { and, eq } from "drizzle-orm";
import {
  validateWorkflowDefinition,
  WORKFLOW_DEFINITION_VERSION,
  WORKFLOW_INTERPRETER_SOURCE_KIND,
  type WorkflowDefinition,
} from "@thinkwork/agent-loops-core";
import { getDb } from "@thinkwork/database-pg";
import {
  memoryProcessorConfigs,
  memorySourceConfigs,
  workflows,
  workflowVersions,
} from "@thinkwork/database-pg/schema";

const WORKFLOW_SLUG = "memory-twenty-proving-slice-u1";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const tenantId = arg("tenant");
  const userId = arg("user");
  const scope = arg("scope") as "space" | "tenant" | undefined;
  const targetId = arg("target");
  const maxRecords = Number(arg("max-records") ?? 25);
  const shouldRun = process.argv.includes("--run");

  if (!tenantId || !userId || !scope || !targetId) {
    console.error(
      "usage: --tenant <id> --user <id> --scope space|tenant --target <id> [--max-records N] [--run]",
    );
    process.exit(2);
  }
  if (scope !== "space" && scope !== "tenant") {
    throw new Error(`--scope must be space|tenant, got ${scope}`);
  }

  const db = getDb();

  // ---- Processor config (one active shared processor per target) ----------
  let [processor] = await db
    .select()
    .from(memoryProcessorConfigs)
    .where(
      and(
        eq(memoryProcessorConfigs.tenant_id, tenantId),
        eq(memoryProcessorConfigs.mode, "shared"),
        eq(memoryProcessorConfigs.target_scope, scope),
        eq(memoryProcessorConfigs.target_id, targetId),
        eq(memoryProcessorConfigs.status, "active"),
      ),
    )
    .limit(1);
  if (!processor) {
    [processor] = await db
      .insert(memoryProcessorConfigs)
      .values({
        tenant_id: tenantId,
        mode: "shared",
        target_scope: scope,
        target_id: targetId,
        enabled: true,
        status: "active",
        budget: { maxRecords },
        created_by_user_id: userId,
      })
      .returning();
  }
  if (!processor) throw new Error("failed to create processor config");

  // ---- Twenty source config ------------------------------------------------
  let [source] = await db
    .select()
    .from(memorySourceConfigs)
    .where(
      and(
        eq(memorySourceConfigs.processor_config_id, processor.id),
        eq(memorySourceConfigs.source_family, "twenty"),
        eq(memorySourceConfigs.source_binding_key, "twenty"),
      ),
    )
    .limit(1);
  if (!source) {
    [source] = await db
      .insert(memorySourceConfigs)
      .values({
        tenant_id: tenantId,
        processor_config_id: processor.id,
        source_family: "twenty",
        source_binding_key: "twenty",
        enabled: true,
        boundary: { maxRecords },
      })
      .returning();
  }
  if (!source) throw new Error("failed to create source config");

  // ---- Workflow definition ---------------------------------------------------
  const stageStep = (stage: string) => ({
    id: `${stage}-twenty`,
    kind: "memory_stage" as const,
    stage: stage as never,
    processorConfigId: processor.id,
    sourceConfigId: source.id,
    ...(stage === "acquire" ? { options: { maxRecords } } : {}),
  });
  const definition: WorkflowDefinition = {
    version: WORKFLOW_DEFINITION_VERSION,
    steps: [
      stageStep("acquire"),
      stageStep("project"),
      stageStep("retain"),
      stageStep("compound"),
    ],
  };
  const validation = validateWorkflowDefinition(definition);
  if (!validation.ok) {
    throw new Error(`definition invalid: ${JSON.stringify(validation.errors)}`);
  }

  let [workflow] = await db
    .select()
    .from(workflows)
    .where(
      and(eq(workflows.tenant_id, tenantId), eq(workflows.slug, WORKFLOW_SLUG)),
    )
    .limit(1);
  if (!workflow) {
    [workflow] = await db
      .insert(workflows)
      .values({
        tenant_id: tenantId,
        name: "Memory: Twenty proving slice (U1)",
        slug: WORKFLOW_SLUG,
        description:
          "THINK-193 U1 — bounded Twenty company acquisition into a shared Hindsight bank (acquire → project → retain → compound).",
        lifecycle_status: "active",
        primary_trigger_family: "manual",
      })
      .returning();
  }
  if (!workflow) throw new Error("failed to create workflow");

  const [current] = await db
    .select({
      id: workflowVersions.id,
      version_number: workflowVersions.version_number,
      definition_snapshot: workflowVersions.definition_snapshot,
    })
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflow_id, workflow.id),
        eq(workflowVersions.version_status, "active"),
      ),
    )
    .limit(1);
  const unchanged =
    current &&
    JSON.stringify(current.definition_snapshot) === JSON.stringify(definition);
  let versionId = current?.id ?? null;
  if (!unchanged) {
    if (current) {
      await db
        .update(workflowVersions)
        .set({ version_status: "superseded" })
        .where(eq(workflowVersions.id, current.id));
    }
    const nextNumber = (current?.version_number ?? 0) + 1;
    const [version] = await db
      .insert(workflowVersions)
      .values({
        tenant_id: tenantId,
        workflow_id: workflow.id,
        version_number: nextNumber,
        version_status: "active",
        source_kind: WORKFLOW_INTERPRETER_SOURCE_KIND,
        definition_snapshot: definition as unknown as Record<string, unknown>,
        published_at: new Date(),
      })
      .returning({ id: workflowVersions.id });
    versionId = version?.id ?? null;
    await db
      .update(workflows)
      .set({
        current_version_id: versionId,
        current_version_number: nextNumber,
        readiness_state: "ready",
        updated_at: new Date(),
      })
      .where(eq(workflows.id, workflow.id));
  }

  const summary = {
    processorConfigId: processor.id,
    sourceConfigId: source.id,
    workflowId: workflow.id,
    workflowVersionId: versionId,
    targetBankId: `${scope}_${targetId}`,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (shouldRun) {
    const { startInterpreterRun } = await import(
      "../../src/lib/workflows/start-interpreter-run.js"
    );
    const result = await startInterpreterRun({
      tenantId,
      workflowId: workflow.id,
      triggerFamily: "manual",
      triggerSource: "seed-twenty-processor",
      idempotencyKey: `seed-${Date.now()}`,
      actorType: "user",
      actorId: userId,
      payload: {},
      requestedByUserId: userId,
    });
    console.log(JSON.stringify({ run: result }, null, 2));
    if (!result.ok) process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
