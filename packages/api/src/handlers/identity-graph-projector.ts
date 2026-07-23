import { bulkRebuildTenantGraph } from "../lib/entity-identity/bulk-rebuild.js";
import { projectPendingIdentityEvents } from "../lib/entity-identity/graph-projection.js";

/**
 * Identity → twin graph projector Lambda (Company Brain U5 / KTD-4;
 * bulk-rebuild lane THINK-331).
 *
 * VPC-attached (Neptune is VPC-only). Invoked as a fire-and-forget nudge
 * after identity writes commit, and directly (RequestResponse) for the
 * bulk-rebuild command. The per-tenant cursor makes missed or duplicate
 * nudges harmless; a projection failure never blocked the relational write
 * (the nudge already swallowed it) — it surfaces here in logs/metrics and
 * heals on the next nudge or bulk-rebuild.
 *
 * Operator invocation recipe for bulk-rebuild (R8):
 *
 *   - RequestResponse invoke with CLIENT RETRIES DISABLED — e.g.
 *     `AWS_MAX_ATTEMPTS=1 aws lambda invoke --cli-read-timeout 0 …`. The
 *     AWS CLI's default retry re-invokes a timed-out call; the per-tenant
 *     fence makes an accidental duplicate safe (it returns the in-progress
 *     loadId instead of re-clearing), but retries still waste the invoke.
 *   - If the response is `{ok: false, status: "in_progress", loadId}`,
 *     re-invoke with `{mode: "bulk-rebuild", loadId}` to resume polling.
 *   - A FAILED `clear: true` run leaves the tenant graph cleared or
 *     partially loaded while read surfaces keep serving — re-run with
 *     `clear: true` to completion (then the etl facet re-sync) before
 *     treating the graph as usable. A no-clear retry is NOT recovery.
 *   - Any `clear: true` run destroys etl-synced facet properties until the
 *     etl facet pipeline re-syncs (its ledger is skip-on-hit) — pair
 *     clear-rebuilds with a facet re-sync.
 *
 * The replay-based `mode: "rebuild"` is retired (THINK-331): it could not
 * finish seed-scale tenants inside the 900s timeout, and a CLI retry
 * re-cleared the graph each attempt. It now returns 400 with a pointer.
 */
export interface IdentityGraphProjectorEvent {
  tenantId?: string;
  mode?: "nudge" | "bulk-rebuild";
  /** bulk-rebuild only: id-prefix-fenced clear before loading (also
   * destroys synced facet properties — see the recipe above). */
  clear?: boolean;
  /** bulk-rebuild only: resume polling a loader job a previous invoke
   * started (returned by an in_progress response). */
  loadId?: string;
}

interface LambdaContextLike {
  getRemainingTimeInMillis?: () => number;
}

export const handler = async (
  event: IdentityGraphProjectorEvent = {},
  context?: LambdaContextLike,
) => {
  const tenantId = event.tenantId;
  if (!tenantId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ ok: false, error: "tenantId required" }),
    };
  }

  if ((event.mode as string) === "rebuild") {
    return {
      statusCode: 400,
      body: JSON.stringify({
        ok: false,
        error:
          'mode "rebuild" was retired (THINK-331) — use mode "bulk-rebuild" ' +
          "(optionally with clear: true)",
      }),
    };
  }
  if (
    event.mode !== undefined &&
    event.mode !== "nudge" &&
    event.mode !== "bulk-rebuild"
  ) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        ok: false,
        error: `unknown mode "${String(event.mode)}"`,
      }),
    };
  }

  try {
    if (event.mode === "bulk-rebuild") {
      const result = await bulkRebuildTenantGraph({
        tenantId,
        clear: event.clear === true,
        loadId: event.loadId,
        getRemainingTimeMs: context?.getRemainingTimeInMillis
          ? () => context.getRemainingTimeInMillis!()
          : undefined,
      });
      // in_progress is a normal outcome (resume with the loadId), so it
      // rides a 200; only failed maps to 500 (R7 — failures surface).
      return {
        statusCode: result.status === "failed" ? 500 : 200,
        body: JSON.stringify(result),
      };
    }

    // Drain in-process (recursive self-invoke trips AWS loop detection —
    // the observations-ingest precedent).
    let passes = 0;
    let processed = 0;
    let resynced = 0;
    for (;;) {
      const pass = await projectPendingIdentityEvents({ tenantId });
      passes += 1;
      processed += pass.processedEvents;
      resynced += pass.resyncedCanonicals;
      if (pass.drained || passes >= 20) break;
    }
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        tenantId,
        passes,
        processedEvents: processed,
        resyncedCanonicals: resynced,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[identity-graph-projector] projection failed", {
      tenantId,
      mode: event.mode ?? "nudge",
      error: message,
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: message }),
    };
  }
};
