/**
 * Twin facet freshness / sync-state resolution (Company Brain U6 — R15).
 *
 * Combines a node's facet stamps (written by the etl twin projection:
 * `f_<facet>__synced_at/batch/seq/state` + cloned values) with the
 * ontology's declared clone policy to produce the R15 trichotomy the agent
 * and page projection behave on:
 *
 *   - `limited`       policy holds the facet out of the clone → follow the
 *                     entity→system edge live.
 *   - `pending`       declared deep-clone but no sync has landed yet →
 *                     follow the edge live AND name the sync state (AE7).
 *   - `synced`        cloned values present, with age.
 *   - `synced_empty`  a sync landed and the source held no values → answer
 *                     definitively, NO live follow-out (AE7).
 *   - `tombstoned`    the source row was deleted — excluded from cohorts.
 */

import {
  parseTwinFacetDeclarations,
  type TwinFacetDeclaration,
} from "../ontology/twin-declarations.js";

export type TwinFacetState =
  | "limited"
  | "pending"
  | "synced"
  | "synced_empty"
  | "tombstoned";

export interface TwinFacetFreshness {
  facet: string;
  state: TwinFacetState;
  syncedAt: string | null;
  ageSeconds: number | null;
  batchId: string | null;
  exportSequence: number | null;
  /** Cloned attribute values present on the node for this facet. */
  values: Record<string, unknown>;
}

export function resolveFacetFreshness(args: {
  facets: TwinFacetDeclaration[] | unknown;
  nodeProperties: Record<string, unknown>;
  now?: Date;
}): TwinFacetFreshness[] {
  const facets = Array.isArray(args.facets)
    ? (args.facets as TwinFacetDeclaration[]).filter(
        (facet) => facet && typeof facet.slug === "string",
      )
    : parseTwinFacetDeclarations(args.facets);
  const now = args.now ?? new Date();
  const props = args.nodeProperties ?? {};

  return facets.map((facet) => {
    const prefix = `f_${facet.slug}__`;
    const syncedAt = asString(props[`${prefix}synced_at`]);
    const state = asString(props[`${prefix}state`]);
    const batchId = asString(props[`${prefix}batch`]);
    const seq = props[`${prefix}seq`];
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (
        key.startsWith(prefix) &&
        !key.endsWith("__synced_at") &&
        !key.endsWith("__batch") &&
        !key.endsWith("__seq") &&
        !key.endsWith("__state") &&
        value !== null &&
        value !== undefined
      ) {
        values[key.slice(prefix.length)] = value;
      }
    }

    let resolved: TwinFacetState;
    if (facet.clonePolicy === "limited") {
      resolved = "limited";
    } else if (state === "tombstoned") {
      resolved = "tombstoned";
    } else if (!syncedAt) {
      resolved = "pending";
    } else if (Object.keys(values).length === 0) {
      resolved = "synced_empty";
    } else {
      resolved = "synced";
    }

    const syncedDate = syncedAt ? new Date(syncedAt) : null;
    return {
      facet: facet.slug,
      state: resolved,
      syncedAt,
      ageSeconds:
        syncedDate && !Number.isNaN(syncedDate.getTime())
          ? Math.max(
              0,
              Math.round((now.getTime() - syncedDate.getTime()) / 1000),
            )
          : null,
      batchId,
      exportSequence: typeof seq === "number" ? seq : null,
      values,
    };
  });
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
