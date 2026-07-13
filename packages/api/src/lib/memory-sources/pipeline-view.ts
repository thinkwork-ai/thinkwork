/**
 * MemoryPipeline projection (THINK-264).
 *
 * Turns a memory processor + its blueprint-built workflow definition into the
 * stage list the Automations Definition tab renders. The stage ORDER and
 * membership come from the blueprint itself (memoryBlueprintFor(mode).build)
 * rather than a hand-kept copy — so the graph can never drift from what the
 * interpreter actually executes, which is the whole point of showing it.
 */

import { and, desc, eq } from "drizzle-orm";
import {
  isToggleableMemoryStage,
  memoryBlueprintFor,
  normalizeDisabledStages,
  TOGGLEABLE_MEMORY_STAGES,
} from "@thinkwork/agent-loops-core";
import {
  memoryProcessorConfigs,
  memoryRunItems,
  memorySourceConfigs,
  scheduledJobs,
  workflowRuns,
  workflows,
} from "@thinkwork/database-pg/schema";

import type { DbHandle } from "./types.js";

/** Human copy for each stage. Keyed by canonical stage kind. */
const STAGE_COPY: Record<string, { label: string; description: string }> = {
  preflight: {
    label: "Preflight",
    description:
      "Check which sources are connected, authorized, and in-boundary, and plan the work.",
  },
  "plan-review": {
    label: "Plan review",
    description:
      "Manual runs pause here so you can narrow the plan before anything is read. Scheduled runs skip it.",
  },
  acquire: {
    label: "Acquire",
    description:
      "Pull new and changed items from your connected sources into evidence.",
  },
  extract: {
    label: "Extract",
    description: "Normalize acquired evidence into a common shape.",
  },
  project: {
    label: "Project",
    description:
      "Turn evidence into claims — the facts your memory is actually built from.",
  },
  resolve: {
    label: "Resolve identity",
    description:
      "Link claims to canonical people, companies, and topics so the same entity from two sources becomes one.",
  },
  retain: {
    label: "Retain",
    description: "Write the resolved claims into your memory bank.",
  },
  compound: {
    label: "Compound",
    description:
      "Consolidate related memories so repeated facts reinforce instead of duplicate.",
  },
  graph: {
    label: "Graph",
    description: "Ingest the affected entities into the knowledge graph.",
  },
  wiki: {
    label: "Wiki",
    description: "Recompile the Wiki pages this run touched.",
  },
};

function copyFor(stage: string): { label: string; description: string } {
  return (
    STAGE_COPY[stage] ?? {
      label: stage.charAt(0).toUpperCase() + stage.slice(1),
      description: "",
    }
  );
}

export interface MemoryPipelineStageView {
  id: string;
  stage: string;
  label: string;
  description: string;
  enabled: boolean;
  toggleable: boolean;
  lastResult: string | null;
}

export interface MemoryPipelineView {
  processorConfigId: string;
  mode: string;
  workflowId: string | null;
  enabled: boolean;
  readiness: string;
  readinessReasons: { code: string; message: string }[];
  scheduleExpression: string | null;
  scheduleTimezone: string | null;
  scheduleEnabled: boolean;
  sources: unknown[];
  stages: MemoryPipelineStageView[];
}

/**
 * Build the pipeline view for a processor. Returns null when the processor is
 * gone (a system loop whose processor was disabled/replaced), so callers can
 * degrade to "no pipeline" rather than throw on a page load.
 */
export async function buildMemoryPipelineView(
  db: DbHandle,
  args: { tenantId: string; processorConfigId: string },
): Promise<MemoryPipelineView | null> {
  const [processor] = await db
    .select()
    .from(memoryProcessorConfigs)
    .where(
      and(
        eq(memoryProcessorConfigs.id, args.processorConfigId),
        eq(memoryProcessorConfigs.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  if (!processor) return null;

  const mode = processor.mode === "personal" ? "personal" : "shared";
  const overrides = processor.stage_overrides ?? null;
  const disabled = new Set<string>(normalizeDisabledStages(overrides));

  // The blueprint OMITS disabled stages from the definition (that is how the
  // toggle actually takes effect). For the graph we want to render them as
  // present-but-off, so build the full definition and mark, rather than
  // reading back the pruned one.
  const full = memoryBlueprintFor(mode).build(processor.id, null);

  const sources = await db
    .select()
    .from(memorySourceConfigs)
    .where(eq(memorySourceConfigs.processor_config_id, processor.id))
    .orderBy(memorySourceConfigs.created_at, memorySourceConfigs.id);

  const lastResults = processor.workflow_id
    ? await lastRunResultsByStage(db, processor.workflow_id)
    : new Map<string, string>();

  const stages: MemoryPipelineStageView[] = full.steps.map((step) => {
    const stageKind =
      step.kind === "memory_stage"
        ? (step as { stage: string }).stage
        : step.id;
    const { label, description } = copyFor(stageKind);
    const toggleable = isToggleableMemoryStage(stageKind);
    return {
      id: step.id,
      stage: stageKind,
      label,
      description,
      enabled: !disabled.has(stageKind),
      toggleable,
      lastResult: lastResults.get(stageKind) ?? null,
    };
  });

  const readinessReasons: { code: string; message: string }[] = [];
  if (!processor.enabled) {
    readinessReasons.push({
      code: "processor_disabled",
      message: "This automation is disabled.",
    });
  }
  if (sources.length === 0) {
    readinessReasons.push({
      code: "no_sources_configured",
      message:
        "No memory sources are configured yet — add a source to give this automation something to process.",
    });
  } else if (!sources.some((s: { enabled: boolean }) => s.enabled)) {
    readinessReasons.push({
      code: "all_sources_disabled",
      message: "Every configured source is disabled.",
    });
  }
  if (processor.workflow_id) {
    const [workflow] = await db
      .select({ readiness_state: workflows.readiness_state })
      .from(workflows)
      .where(eq(workflows.id, processor.workflow_id))
      .limit(1);
    if (workflow && workflow.readiness_state !== "ready") {
      readinessReasons.push({
        code: `workflow_${workflow.readiness_state}`,
        message: "The managed workflow is not ready to run.",
      });
    }
  }

  const schedule = processor.workflow_id
    ? await loadWorkflowSchedule(db, processor.workflow_id)
    : null;

  return {
    processorConfigId: processor.id,
    mode: processor.mode,
    workflowId: processor.workflow_id ?? null,
    enabled: processor.enabled,
    readiness: readinessReasons.length === 0 ? "ready" : "blocked_not_ready",
    scheduleExpression: schedule?.schedule_expression ?? null,
    scheduleTimezone: schedule?.timezone ?? null,
    scheduleEnabled: schedule?.enabled ?? false,
    readinessReasons,
    sources: sources.map((source: Record<string, unknown>) => ({
      id: source.id,
      processorConfigId: source.processor_config_id,
      sourceFamily: source.source_family,
      sourceBindingKey: source.source_binding_key,
      enabled: source.enabled,
      boundary: source.boundary,
      createdAt:
        source.created_at instanceof Date
          ? source.created_at.toISOString()
          : (source.created_at ?? null),
    })),
    stages,
  };
}

/**
 * The worst outcome each stage reported on the most recent run, so a node that
 * failed reads "failed" even when it also logged successful items. Ordered by
 * severity, not recency — a single failure is the thing worth surfacing.
 */
const RESULT_SEVERITY = [
  "failed",
  "deferred",
  "retracted",
  "changed",
  "seen",
  "noop",
];

async function lastRunResultsByStage(
  db: DbHandle,
  workflowId: string,
): Promise<Map<string, string>> {
  const [run] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflow_id, workflowId))
    .orderBy(desc(workflowRuns.created_at))
    .limit(1);
  const results = new Map<string, string>();
  if (!run) return results;

  const items = await db
    .select({ stage: memoryRunItems.stage, result: memoryRunItems.result })
    .from(memoryRunItems)
    .where(eq(memoryRunItems.workflow_run_id, run.id));

  for (const item of items as { stage: string; result: string }[]) {
    const existing = results.get(item.stage);
    if (
      !existing ||
      RESULT_SEVERITY.indexOf(item.result) < RESULT_SEVERITY.indexOf(existing)
    ) {
      results.set(item.stage, item.result);
    }
  }
  return results;
}

/**
 * The workflow's bound schedule, so the Definition tab can show and edit the
 * cadence. Kept here (rather than on Workflow) because it is the one piece of
 * the old card's UI that had nowhere else to live.
 */
async function loadWorkflowSchedule(
  db: DbHandle,
  workflowId: string,
): Promise<{
  schedule_expression: string | null;
  timezone: string | null;
  enabled: boolean;
} | null> {
  const [row] = await db
    .select({
      schedule_expression: scheduledJobs.schedule_expression,
      timezone: scheduledJobs.timezone,
      enabled: scheduledJobs.enabled,
    })
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.workflow_id, workflowId),
        eq(scheduledJobs.trigger_type, "workflow_schedule"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export { TOGGLEABLE_MEMORY_STAGES };
