/**
 * Per-connector live-fetch registry (Company Brain U8 / KTD-8, R14).
 *
 * Live-routed page sections fetch server-side under the TENANT SERVICE
 * credential — the same trust as ingestion — keyed off the system node's
 * connector slug. Systems without a registered fetcher (and explicitly the
 * VPC-egress-only lastmile ERP in this arc) are NOT live-routable: their
 * sections render facet-backed/STALE instead of fetching on view. The
 * registry is the only place that decides live-routability, so the page
 * projection never grows per-connector branches.
 */

export interface LiveFetchRequest {
  tenantId: string;
  systemSlug: string;
  externalId: string;
  /** Present when the fetch rides a viewer's plugin binding (see
   *  twenty-live-fetch.ts deviation note). */
  viewerUserId?: string;
}

export type LiveFetchResult =
  | { state: "OK"; data: Record<string, unknown>; fetchedAt: string }
  | { state: "STALE"; reason: "not_live_routable" }
  | { state: "ERROR"; reason: string };

type LiveFetcher = (request: LiveFetchRequest) => Promise<LiveFetchResult>;

/** VPC-egress-only systems — declared not-live-routable in this arc (KTD-8). */
const NOT_LIVE_ROUTABLE = new Set(["lastmile"]);

async function fetchTwentyCompany(
  request: LiveFetchRequest,
): Promise<LiveFetchResult> {
  // Service-credential Twenty read (the managed-application config store
  // precedent). Dynamic import keeps the registry load-light for callers
  // that never live-fetch.
  const { fetchTwentyRecordForTenant } = await import("./twenty-live-fetch.js");
  return fetchTwentyRecordForTenant(request);
}

const REGISTRY: Record<string, LiveFetcher> = {
  twenty: fetchTwentyCompany,
};

export function isLiveRoutable(systemSlug: string): boolean {
  return !NOT_LIVE_ROUTABLE.has(systemSlug) && systemSlug in REGISTRY;
}

export async function fetchLive(
  request: LiveFetchRequest,
): Promise<LiveFetchResult> {
  if (!isLiveRoutable(request.systemSlug)) {
    return { state: "STALE", reason: "not_live_routable" };
  }
  try {
    return await REGISTRY[request.systemSlug](request);
  } catch (err) {
    return {
      state: "ERROR",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
