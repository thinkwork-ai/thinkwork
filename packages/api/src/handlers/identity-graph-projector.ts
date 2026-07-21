import {
  projectPendingIdentityEvents,
  rebuildTenantGraph,
} from "../lib/entity-identity/graph-projection.js";

/**
 * Identity → twin graph projector Lambda (Company Brain U5 / KTD-4).
 *
 * VPC-attached (Neptune is VPC-only). Invoked as a fire-and-forget nudge
 * after identity writes commit, and directly (RequestResponse) for the
 * first-class rebuild command. The per-tenant cursor makes missed or
 * duplicate nudges harmless; a projection failure never blocked the
 * relational write (the nudge already swallowed it) — it surfaces here in
 * logs/metrics and heals on the next nudge or rebuild.
 */
export interface IdentityGraphProjectorEvent {
  tenantId?: string;
  mode?: "nudge" | "rebuild";
}

export const handler = async (event: IdentityGraphProjectorEvent = {}) => {
  const tenantId = event.tenantId;
  if (!tenantId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ ok: false, error: "tenantId required" }),
    };
  }

  try {
    if (event.mode === "rebuild") {
      const result = await rebuildTenantGraph({ tenantId });
      return { statusCode: 200, body: JSON.stringify({ ok: true, ...result }) };
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
