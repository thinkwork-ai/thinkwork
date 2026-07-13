/**
 * connectionResearch — the research view of the governed capability
 * runtime (THINK-280 U2, R3/R4).
 *
 * Operator/admin-gated (same gate as the assignment mutations). Research
 * is NON-EXECUTABLE knowledge: admitted/platform definitions + stored
 * proposals matching the query. No external fetcher is wired in this
 * slice — `allowExternal: true` degrades the state with a fixed detail
 * string and never affects the DB-backed results.
 */

import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { searchCapabilityRuntime } from "../../../lib/capabilities/research.js";
import {
  definitionToGql,
  loadVersionRowsByDefinition,
  proposalToGql,
} from "./capabilityRuntime.shared.js";

export const EXTERNAL_DISCOVERY_DISABLED_DETAIL =
  "external discovery not yet enabled";

export async function connectionResearch(
  _parent: unknown,
  args: { tenantId: string; query: string; allowExternal?: boolean | null },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "capabilities:research",
  );

  const allowExternal = args.allowExternal === true;
  const result = await searchCapabilityRuntime(db, {
    tenantId: args.tenantId,
    query: args.query,
    allowExternal,
    // No external fetcher exists in this slice — the lib degrades state.
    externalFetcher: undefined,
  });

  const versionsByDefinition = await loadVersionRowsByDefinition(
    result.definitions.map((row) => row.id),
  );

  return {
    state: result.state,
    stateDetail:
      allowExternal && result.state === "degraded"
        ? EXTERNAL_DISCOVERY_DISABLED_DETAIL
        : (result.stateDetail ?? null),
    definitions: result.definitions.map((row) =>
      definitionToGql(row, versionsByDefinition.get(row.id) ?? []),
    ),
    proposals: result.proposals.map(proposalToGql),
  };
}
