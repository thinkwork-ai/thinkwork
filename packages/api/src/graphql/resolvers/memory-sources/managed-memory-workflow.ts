/**
 * Shared GraphQL shaping for ManagedMemoryWorkflow (THINK-193 U3): the
 * processor + blueprint workflow + sources + computed readiness returned by
 * personalMemoryAutomation / ensureSharedMemoryWorkflow /
 * setPersonalMemoryAutomationSchedule.
 */

import { snakeToCamel } from "../../utils.js";
import type { EnsuredMemoryAutomation } from "../../../lib/memory-sources/provisioning.js";

export interface ReadinessReason {
  code: string;
  message: string;
}

export function toGraphqlManagedMemoryWorkflow(
  ensured: EnsuredMemoryAutomation,
  /** Caller-computed extra readiness reasons (U6: email connect state). */
  extraReasons: ReadinessReason[] = [],
) {
  const reasons: ReadinessReason[] = [...extraReasons];
  if (!ensured.workflow) {
    reasons.push({
      code: "no_workflow",
      message: "The managed workflow has not been provisioned yet.",
    });
  } else if (ensured.workflow.readiness_state !== "ready") {
    reasons.push({
      code: `workflow_${ensured.workflow.readiness_state}`,
      message: "The managed workflow is not ready to run.",
    });
  }
  // Thread conversations are the baseline source and are retained into the
  // target Hindsight bank at the end of each turn. The rows in `sources` are
  // optional external enrichments (Gmail, Twenty, web, KB), so having none —
  // or having every external source disabled — must not block the workflow.

  return {
    processor: {
      id: ensured.processor.id,
      mode: ensured.processor.mode,
      targetScope: ensured.processor.target_scope,
      targetId: ensured.processor.target_id,
      enabled: ensured.processor.enabled,
      status: ensured.processor.status,
      budget: ensured.processor.budget,
      createdByUserId: ensured.processor.created_by_user_id,
      createdAt: toIso(ensured.processor.created_at),
    },
    workflow: ensured.workflow ? snakeToCamel(ensured.workflow) : null,
    sources: ensured.sources.map((source) => ({
      id: source.id,
      processorConfigId: source.processor_config_id,
      sourceFamily: source.source_family,
      sourceBindingKey: source.source_binding_key,
      enabled: source.enabled,
      boundary: source.boundary,
      createdAt: toIso(source.created_at),
    })),
    readiness: reasons.length === 0 ? "ready" : "blocked_not_ready",
    readinessReasons: reasons,
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
