/**
 * Twenty live fetcher (Company Brain U8 / KTD-8).
 *
 * Fetches one company record on view for a live-routed section, via the
 * platform's Twenty context resolution (managed application + plugin auth).
 * DEVIATION (recorded on the arc's Linear issue): the plugin auth layer
 * mints tokens per user, so the fetch resolves with the viewing user's
 * binding rather than a standalone tenant service credential — the section
 * still renders server-side and visibility stays operator-declared (R14).
 * A viewer with no Twenty connection gets a per-section ERROR (403 text),
 * never a blanked page.
 */

import { db } from "../db.js";
import type {
  LiveFetchRequest,
  LiveFetchResult,
} from "./live-fetch-registry.js";

export async function fetchTwentyRecordForTenant(
  request: LiveFetchRequest,
): Promise<LiveFetchResult> {
  if (!request.viewerUserId) {
    return { state: "ERROR", reason: "no_viewer_for_live_fetch" };
  }
  const { resolveTwentyContext } = await import("../twenty/rest-client.js");
  const { TwentyRestClient } = await import("../twenty/rest-client.js");
  const context = await resolveTwentyContext(db, {
    tenantId: request.tenantId,
    userId: request.viewerUserId,
    logPrefix: "[twin:live-fetch]",
    unauthorizedMessage:
      "Connect your Twenty CRM account to view live sections",
  });
  if (!context) {
    return { state: "ERROR", reason: "twenty_not_configured" };
  }
  const client = new TwentyRestClient(context.baseUrl, context.token);
  const page = await client.listPage(
    `companies/${encodeURIComponent(request.externalId)}`,
  );
  const record = page.records[0] ?? null;
  if (!record) {
    return { state: "ERROR", reason: "record_not_found" };
  }
  return {
    state: "OK",
    data: record,
    fetchedAt: new Date().toISOString(),
  };
}
