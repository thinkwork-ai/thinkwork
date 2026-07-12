/**
 * GET /msteams/install/complete
 *
 * Microsoft admin-consent redirect target. Unauthenticated ingress — the
 * signed install state (minted by install-start, HMAC'd with the Teams app
 * client_secret) is the authorization. Query params on success:
 * admin_consent=True, tenant=<entraTenantId>, state=<state>. Error paths
 * carry error/error_description instead.
 *
 * Single-use enforcement: the pending -> active transition on the tenant
 * install row is the gate. A replayed callback for the SAME Entra tenant
 * finds the row already active and returns an idempotent 200 no-op with no
 * mutation. A stolen state redeemed from a DIFFERENT Entra tenant fails
 * closed: if the ThinkWork tenant already has an active binding, or the new
 * Entra tenant is bound to another ThinkWork tenant
 * (MsteamsTenantConflictError), the handler returns 409 with no mutation.
 *
 * Never logs or returns signed state, tokens, or the client_secret.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { error, json } from "../../lib/response.js";
import {
  getMsteamsAppCredentials,
  verifyMsteamsInstallState,
  type MsteamsAppCredentials,
  type MsteamsInstallStatePayload,
} from "../../lib/msteams/install-state.js";
import {
  MsteamsTenantConflictError,
  activateTenantInstall,
  getTenantInstallStatus,
  markConsent,
  upsertTenantInstall,
} from "../../lib/msteams/tenant-store.js";

export interface MsteamsInstallCompleteDeps {
  getCredentials?: () => Promise<MsteamsAppCredentials>;
  getInstallStatus?: typeof getTenantInstallStatus;
  upsertInstall?: typeof upsertTenantInstall;
  activateInstall?: typeof activateTenantInstall;
  markConsentStatus?: typeof markConsent;
  nowMs?: () => number;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  return handleMsteamsInstallComplete(event);
}

export async function handleMsteamsInstallComplete(
  event: APIGatewayProxyEventV2,
  deps: MsteamsInstallCompleteDeps = {},
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method !== "GET") {
    return error("Method not allowed", 405);
  }

  const params = new URLSearchParams(event.rawQueryString ?? "");
  const stateParam = params.get("state") || "";
  if (!stateParam) {
    return error("Teams install state is required", 400);
  }

  const getCredentials = deps.getCredentials ?? getMsteamsAppCredentials;
  const credentials = await getCredentials();

  let state: MsteamsInstallStatePayload;
  try {
    state = verifyMsteamsInstallState(
      stateParam,
      credentials.clientSecret,
      deps.nowMs,
    );
  } catch (err) {
    return error((err as Error).message, 401);
  }

  const markConsentStatus = deps.markConsentStatus ?? markConsent;
  const upsertInstall = deps.upsertInstall ?? upsertTenantInstall;

  const consentError = params.get("error");
  if (consentError) {
    // Consent was declined or requires escalation. When Microsoft reports
    // the Entra tenant, persist a pending install stamped admin_required so
    // the health surface is diagnosable; without it there is nothing to
    // bind, so only report. Never echo error_description verbatim into logs.
    const reportedEntraTenantId = params.get("tenant");
    if (reportedEntraTenantId) {
      try {
        await upsertInstall({
          tenantId: state.tenantId,
          entraTenantId: reportedEntraTenantId,
          botAppId: credentials.appId,
          installedByUserId: state.adminUserId,
        });
        await markConsentStatus({
          entraTenantId: reportedEntraTenantId,
          consentStatus: "admin_required",
        });
      } catch (err) {
        if (!(err instanceof MsteamsTenantConflictError)) throw err;
        // The Entra tenant is bound to another ThinkWork tenant; nothing to
        // stamp here — the declined consent already prevents installation.
      }
    }
    return json({
      installed: false,
      consent: "admin_required",
      reason:
        "Microsoft admin consent was declined or requires a Global Administrator. Re-run the install once consent can be granted.",
    });
  }

  const adminConsent = (params.get("admin_consent") || "").toLowerCase();
  const entraTenantId = params.get("tenant") || "";
  if (adminConsent !== "true" || !entraTenantId) {
    return error("Teams admin-consent callback is incomplete", 400);
  }

  // Single-use gate: only a still-pending install for this ThinkWork tenant
  // may activate. An already-active binding short-circuits.
  const getInstallStatus = deps.getInstallStatus ?? getTenantInstallStatus;
  const rows = await getInstallStatus({ tenantId: state.tenantId });
  const activeRow = rows.find((row) => row.status === "active");
  if (activeRow) {
    if (activeRow.entra_tenant_id === entraTenantId) {
      // Replayed callback for the same Entra tenant: idempotent no-op.
      return json({ installed: true, alreadyActive: true });
    }
    // Replayed/stolen state redeemed from a different Entra tenant.
    return error(
      "Microsoft Teams is already installed for this ThinkWork tenant from a different Entra tenant",
      409,
    );
  }

  try {
    await upsertInstall({
      tenantId: state.tenantId,
      entraTenantId,
      botAppId: credentials.appId,
      installedByUserId: state.adminUserId,
    });
  } catch (err) {
    if (err instanceof MsteamsTenantConflictError) {
      return error(
        "This Microsoft (Entra) tenant is already bound to a different ThinkWork tenant. Contact your ThinkWork operator to resolve the existing binding.",
        409,
      );
    }
    throw err;
  }

  const activateInstall = deps.activateInstall ?? activateTenantInstall;
  await activateInstall({ entraTenantId, consentStatus: "granted" });

  return json({ installed: true, entraTenantId });
}
