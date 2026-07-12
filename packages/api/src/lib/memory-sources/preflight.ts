/**
 * Preflight stage (THINK-193 U3): build the reviewable plan a manual run's
 * approval step displays.
 *
 * ADVISORY ONLY, strictly inside saved boundaries: the plan enumerates the
 * processor's already-configured, enabled sources, their grant status,
 * checkpoint freshness, and effective limits, plus recent focus candidates
 * derived from prior evidence. It may NOT discover new credentials, folders,
 * or scopes — everything shown is something the run could already read.
 * The approval UI renders the plan from this stage's recorded step output;
 * the reviewer's narrowing comes back as the approved-plan override.
 */

import { desc, eq } from "drizzle-orm";
import { memoryEvidenceItems } from "@thinkwork/database-pg/schema";
import type { MemoryStageWorkerResult } from "@thinkwork/agent-loops-core";

import { getActiveGrant, grantInactiveReason } from "./policy.js";
import { getCheckpoint } from "./repository.js";
import { BOUNDARY_SCHEMAS } from "./policy.js";
import { getMemorySourceAdapter } from "./adapters/registry.js";
import type { StageContext } from "./stages.js";

/** Cap on focus candidates so the plan stays a bounded step output. */
const MAX_FOCUS_KEYS = 20;
const MAX_RECENT_EVIDENCE = 50;

export interface PreflightSourcePlan {
  sourceConfigId: string;
  sourceFamily: string;
  sourceBindingKey: string;
  enabled: boolean;
  /** active | missing | revoked | expired | <status> */
  grantStatus: string;
  /** Saved source boundary (governed dimensions only — no secrets). */
  boundary: Record<string, unknown>;
  /** Effective per-run caps after boundary/budget defaults. */
  effectiveMaxRecords: number | null;
  /** ISO timestamp of the last checkpoint advance, when one exists. */
  checkpointAdvancedAt: string | null;
  /** Recent evidence rows recorded for this source (bounded count). */
  recentEvidenceCount: number;
}

export interface PreflightPlan {
  generatedAt: string;
  processorConfigId: string;
  mode: string;
  targetScope: string;
  sources: PreflightSourcePlan[];
  /** Advisory focus candidates (recent evidence subjects), never new scope. */
  focus: Array<{ key: string; label: string }>;
}

export async function runPreflight(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
  const { db, event, processor } = ctx;
  const sources: PreflightSourcePlan[] = [];
  const focus = new Map<string, string>();

  for (const source of ctx.sources) {
    // Grant status — the maximum readable envelope; missing/inactive grants
    // surface on the plan instead of failing preflight (the reviewer sees
    // exactly which source is blocked and why).
    let grantStatus = "missing";
    const grant = await getActiveGrant(db, {
      tenantId: processor.tenant_id,
      processorConfigId: processor.id,
      sourceFamily: source.source_family,
      sourceBindingKey: source.source_binding_key,
    });
    if (grant) {
      grantStatus = grantInactiveReason(grant) ?? "active";
    }

    // Per-family checkpoint partition + focus labels via the adapter
    // registry (U5 dispatch seam); an unregistered family falls back to a
    // family-named partition (no checkpoint will exist — shows never synced).
    const adapter = getMemorySourceAdapter(source.source_family);
    const checkpoint = await getCheckpoint(db, {
      sourceConfigId: source.id,
      partitionKey: adapter?.partitionKey ?? source.source_family,
    });

    const recent = await db
      .select({
        source_item_id: memoryEvidenceItems.source_item_id,
        snapshot: memoryEvidenceItems.normalized_snapshot,
      })
      .from(memoryEvidenceItems)
      .where(eq(memoryEvidenceItems.source_config_id, source.id))
      .orderBy(desc(memoryEvidenceItems.updated_at))
      .limit(MAX_RECENT_EVIDENCE);

    for (const row of recent) {
      if (focus.size >= MAX_FOCUS_KEYS) break;
      const key = `${source.source_family}:${row.source_item_id}`;
      const snapshot = row.snapshot as Record<string, unknown> | null;
      const label = adapter
        ? adapter.focusLabelFor(snapshot, row.source_item_id)
        : typeof snapshot?.name === "string"
          ? String(snapshot.name)
          : row.source_item_id;
      if (!focus.has(key)) focus.set(key, label);
    }

    const boundary = (source.boundary ?? {}) as Record<string, unknown>;
    const schema = BOUNDARY_SCHEMAS[source.source_family];
    const maxRecordsDim = schema?.maxRecords;
    const effectiveMaxRecords =
      typeof boundary.maxRecords === "number"
        ? (boundary.maxRecords as number)
        : maxRecordsDim && maxRecordsDim.kind === "cap"
          ? maxRecordsDim.default
          : null;

    sources.push({
      sourceConfigId: source.id,
      sourceFamily: source.source_family,
      sourceBindingKey: source.source_binding_key,
      enabled: source.enabled,
      grantStatus,
      boundary,
      effectiveMaxRecords,
      checkpointAdvancedAt: checkpoint?.last_advanced_at
        ? new Date(checkpoint.last_advanced_at).toISOString()
        : null,
      recentEvidenceCount: recent.length,
    });
  }

  const plan: PreflightPlan = {
    generatedAt: new Date().toISOString(),
    processorConfigId: processor.id,
    mode: processor.mode,
    targetScope: processor.target_scope,
    sources,
    focus: [...focus.entries()].map(([key, label]) => ({ key, label })),
  };

  return {
    status: "succeeded",
    stage: event.stage,
    counts: {
      sources: sources.length,
      ready: sources.filter((s) => s.grantStatus === "active" && s.enabled)
        .length,
    },
    output: { plan: plan as unknown as Record<string, unknown> },
  };
}
