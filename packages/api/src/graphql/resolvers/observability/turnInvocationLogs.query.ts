/**
 * Query Bedrock model invocation logs for a specific turn.
 *
 * The resolver remains read-only: it fetches provider logs for the turn window
 * and annotates them with the same reconciliation decision rules used by the
 * background reconciler. The scheduled handler persists facts.
 */

import type { GraphQLContext } from "../../context.js";
import {
  fetchBedrockInvocationLogsForWindow,
  loadTurnInvocationReconciliationInput,
  modelInvocationLogView,
  normalizeInvocationTimestamp,
  reconcileInvocationRecords,
} from "../../../lib/trace-ledger/bedrock-invocation-reconciler.js";

export { normalizeInvocationTimestamp };

export const turnInvocationLogs = async (
  _parent: any,
  args: any,
  _ctx: GraphQLContext,
) => {
  const loaded = await loadTurnInvocationReconciliationInput(
    args.tenantId,
    args.turnId,
  );
  if (!loaded.window) return [];

  try {
    const providerRecords = await fetchBedrockInvocationLogsForWindow({
      ...loaded.window,
    });
    const decisions = reconcileInvocationRecords(
      loaded.runtimeObservations,
      providerRecords,
    );
    return providerRecords.map((record) =>
      modelInvocationLogView(record, decisions),
    );
  } catch (err) {
    const code = (err as { name?: string }).name;
    if (code === "ResourceNotFoundException") return [];
    console.error("[turnInvocationLogs] Error querying CloudWatch:", err);
    return [];
  }
};
