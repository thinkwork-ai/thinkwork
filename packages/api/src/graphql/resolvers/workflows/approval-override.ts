/**
 * Server-side validation of an approved-plan override (THINK-193 U3).
 *
 * The override may only NARROW the saved processor configuration:
 *  - it applies exclusively to blueprint-managed memory workflows;
 *  - every sourceConfigId must be one of the processor's own enabled
 *    source configs;
 *  - maxRecords must not exceed any selected source's saved boundary cap
 *    (falling back to the family schema default when the boundary omits it).
 * The stage runtime re-enforces narrow-only semantics regardless — this
 * validation exists so the reviewer gets an immediate, specific error.
 */

import {
  sanitizeApprovalPlanOverride,
  type ApprovalPlanOverride,
} from "@thinkwork/agent-loops-core";
import { findMemoryProcessorForWorkflow } from "@thinkwork/database-pg";

import type { DbHandle } from "../../../lib/memory-sources/types.js";
import { listEnabledSourceConfigs } from "../../../lib/memory-sources/repository.js";
import { BOUNDARY_SCHEMAS } from "../../../lib/memory-sources/policy.js";

export interface WorkflowApprovalOverrideInput {
  sourceConfigIds?: string[] | null;
  focusKeys?: string[] | null;
  timeRangeFrom?: string | null;
  timeRangeTo?: string | null;
  maxRecords?: number | null;
}

/** Flat GraphQL input -> frozen protocol shape (null when empty). */
export function overrideInputToProtocol(
  input: WorkflowApprovalOverrideInput | null | undefined,
): ApprovalPlanOverride | null {
  if (!input) return null;
  return sanitizeApprovalPlanOverride({
    ...(input.sourceConfigIds != null
      ? { sourceConfigIds: input.sourceConfigIds }
      : {}),
    ...(input.focusKeys != null ? { focusKeys: input.focusKeys } : {}),
    ...(input.timeRangeFrom != null || input.timeRangeTo != null
      ? {
          timeRange: {
            ...(input.timeRangeFrom != null
              ? { from: input.timeRangeFrom }
              : {}),
            ...(input.timeRangeTo != null ? { to: input.timeRangeTo } : {}),
          },
        }
      : {}),
    ...(input.maxRecords != null ? { maxRecords: input.maxRecords } : {}),
  });
}

/**
 * Validate a (already shape-sanitized) override against the workflow's
 * memory processor configuration. Throws with a reviewer-actionable message
 * on any expansion attempt.
 */
export async function assertOverrideNarrowsSavedConfig(
  db: DbHandle,
  args: {
    tenantId: string;
    workflowId: string;
    override: ApprovalPlanOverride;
  },
): Promise<void> {
  const processor = await findMemoryProcessorForWorkflow(db, {
    tenantId: args.tenantId,
    workflowId: args.workflowId,
  });
  if (!processor) {
    throw new Error(
      "A plan override only applies to managed memory workflows — this run's workflow has no memory processor",
    );
  }

  const sources = await listEnabledSourceConfigs(db, {
    tenantId: args.tenantId,
    processorConfigId: processor.id,
  });
  const configured = new Map(sources.map((source) => [source.id, source]));

  const selectedIds = args.override.sourceConfigIds ?? [...configured.keys()];
  for (const id of selectedIds) {
    if (!configured.has(id)) {
      throw new Error(
        `Source ${id} is not one of this automation's enabled sources — a plan override can only select among already-configured sources, never add one`,
      );
    }
  }

  if (args.override.maxRecords != null) {
    let highestCap = 0;
    for (const id of selectedIds) {
      const source = configured.get(id)!;
      const boundary = (source.boundary ?? {}) as Record<string, unknown>;
      const dimension = BOUNDARY_SCHEMAS[source.source_family]?.maxRecords;
      const cap =
        typeof boundary.maxRecords === "number"
          ? (boundary.maxRecords as number)
          : dimension && dimension.kind === "cap"
            ? dimension.default
            : 0;
      highestCap = Math.max(highestCap, cap);
    }
    if (selectedIds.length > 0 && args.override.maxRecords > highestCap) {
      throw new Error(
        `maxRecords ${args.override.maxRecords} exceeds the saved boundary cap (${highestCap}) — a plan override can only narrow the saved configuration`,
      );
    }
  }
}
