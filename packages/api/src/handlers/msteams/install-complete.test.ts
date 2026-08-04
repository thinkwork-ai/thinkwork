import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MSTEAMS_INSTALL_STATE_TTL_MS,
  createMsteamsInstallState,
} from "../../lib/msteams/install-state.js";
import { MsteamsTenantConflictError } from "../../lib/msteams/tenant-store.js";
import { handleMsteamsInstallComplete } from "./install-complete.js";

const CREDENTIALS = { appId: "app-1", clientSecret: "teams-client-secret" };

function event(query: string, method = "GET"): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${method} /msteams/install/complete`,
    rawPath: "/msteams/install/complete",
    rawQueryString: query,
    headers: {},
    requestContext: {
      accountId: "1",
      apiId: "api",
      domainName: "api.example.com",
      domainPrefix: "api",
      http: {
        method,
        path: "/msteams/install/complete",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "req",
      routeKey: `${method} /msteams/install/complete`,
      stage: "$default",
      time: "16/May/2026:00:00:00 +0000",
      timeEpoch: 1,
    },
    isBase64Encoded: false,
  };
}

function signedState(): string {
  return createMsteamsInstallState({
    tenantId: "tenant-1",
    adminUserId: "admin-1",
    signingKey: CREDENTIALS.clientSecret,
    nowMs: () => 1_000,
    nonce: "nonce-1",
  });
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    getCredentials: vi.fn().mockResolvedValue(CREDENTIALS),
    verifyConsent: vi.fn().mockResolvedValue({ granted: true }),
    getInstallStatus: vi.fn().mockResolvedValue([]),
    upsertInstall: vi.fn().mockResolvedValue({}),
    activateInstall: vi.fn().mockResolvedValue({}),
    markConsentStatus: vi.fn().mockResolvedValue({}),
    nowMs: () => 2_000,
    ...overrides,
  } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("msteams install-complete handler", () => {
  it("binds and activates on a valid admin-consent callback", async () => {
    const d = deps();
    const state = signedState();
    const response = await handleMsteamsInstallComplete(
      event(
        `admin_consent=True&tenant=entra-1&state=${encodeURIComponent(state)}`,
      ),
      d,
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      installed: true,
      entraTenantId: "entra-1",
    });
    expect(d.upsertInstall).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      entraTenantId: "entra-1",
      botAppId: "app-1",
      installedByUserId: "admin-1",
    });
    expect(d.activateInstall).toHaveBeenCalledWith({
      entraTenantId: "entra-1",
      consentStatus: "granted",
    });
    expect(d.verifyConsent).toHaveBeenCalledWith({
      entraTenantId: "entra-1",
      appId: "app-1",
      clientSecret: CREDENTIALS.clientSecret,
    });
  });

  it("returns 403 and mutates nothing when Microsoft does not confirm consent", async () => {
    const d = deps({
      verifyConsent: vi
        .fn()
        .mockResolvedValue({ granted: false, reason: "invalid_client" }),
    });
    const state = signedState();
    const response = await handleMsteamsInstallComplete(
      event(
        `admin_consent=True&tenant=entra-1&state=${encodeURIComponent(state)}`,
      ),
      d,
    );

    expect(response.statusCode).toBe(403);
    expect(d.upsertInstall).not.toHaveBeenCalled();
    expect(d.activateInstall).not.toHaveBeenCalled();
    expect(d.markConsentStatus).not.toHaveBeenCalled();
  });

  it("returns 409 when activation matches no pending or uninstalled row", async () => {
    // activateTenantInstall returns null for revoked (or otherwise
    // ineligible) rows — callback replay never reactivates a revoked install.
    const d = deps({ activateInstall: vi.fn().mockResolvedValue(null) });
    const state = signedState();
    const response = await handleMsteamsInstallComplete(
      event(
        `admin_consent=True&tenant=entra-1&state=${encodeURIComponent(state)}`,
      ),
      d,
    );

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body ?? "{}").error).toMatch(
      /not pending activation/,
    );
  });

  it("treats a replayed callback for the same Entra tenant as an idempotent no-op", async () => {
    const d = deps({
      getInstallStatus: vi
        .fn()
        .mockResolvedValue([{ entra_tenant_id: "entra-1", status: "active" }]),
    });
    const state = signedState();
    const response = await handleMsteamsInstallComplete(
      event(
        `admin_consent=True&tenant=entra-1&state=${encodeURIComponent(state)}`,
      ),
      d,
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      installed: true,
      alreadyActive: true,
    });
    expect(d.upsertInstall).not.toHaveBeenCalled();
    expect(d.activateInstall).not.toHaveBeenCalled();
    expect(d.verifyConsent).not.toHaveBeenCalled();
  });

  it("fails closed with 409 when a stolen state is redeemed from a different Entra tenant", async () => {
    const d = deps({
      getInstallStatus: vi
        .fn()
        .mockResolvedValue([{ entra_tenant_id: "entra-1", status: "active" }]),
    });
    const state = signedState();
    const response = await handleMsteamsInstallComplete(
      event(
        `admin_consent=True&tenant=entra-evil&state=${encodeURIComponent(
          state,
        )}`,
      ),
      d,
    );

    expect(response.statusCode).toBe(409);
    expect(d.upsertInstall).not.toHaveBeenCalled();
    expect(d.activateInstall).not.toHaveBeenCalled();
  });

  it("returns 409 without activating when the Entra tenant is bound to another ThinkWork tenant", async () => {
    const d = deps({
      upsertInstall: vi
        .fn()
        .mockRejectedValue(new MsteamsTenantConflictError("entra-1")),
    });
    const state = signedState();
    const response = await handleMsteamsInstallComplete(
      event(
        `admin_consent=True&tenant=entra-1&state=${encodeURIComponent(state)}`,
      ),
      d,
    );

    expect(response.statusCode).toBe(409);
    expect(d.activateInstall).not.toHaveBeenCalled();
  });

  it("rejects a tampered state with 401 and no mutation", async () => {
    const d = deps();
    const state = signedState();
    const [encoded, signature] = state.split(".");
    const tampered = `${encoded.slice(0, -2)}xx.${signature}`;
    const response = await handleMsteamsInstallComplete(
      event(
        `admin_consent=True&tenant=entra-1&state=${encodeURIComponent(
          tampered,
        )}`,
      ),
      d,
    );
    expect(response.statusCode).toBe(401);
    expect(d.upsertInstall).not.toHaveBeenCalled();
    expect(d.activateInstall).not.toHaveBeenCalled();
    expect(d.markConsentStatus).not.toHaveBeenCalled();
  });

  it("rejects an expired state with 401", async () => {
    const d = deps({ nowMs: () => 1_000 + MSTEAMS_INSTALL_STATE_TTL_MS + 1 });
    const state = signedState();
    const response = await handleMsteamsInstallComplete(
      event(
        `admin_consent=True&tenant=entra-1&state=${encodeURIComponent(state)}`,
      ),
      d,
    );
    expect(response.statusCode).toBe(401);
    expect(d.upsertInstall).not.toHaveBeenCalled();
  });

  it("rejects a malformed state with 401 and a missing state with 400", async () => {
    const d = deps();
    const malformed = await handleMsteamsInstallComplete(
      event("admin_consent=True&tenant=entra-1&state=not-a-state"),
      d,
    );
    expect(malformed.statusCode).toBe(401);

    const missing = await handleMsteamsInstallComplete(
      event("admin_consent=True&tenant=entra-1"),
      d,
    );
    expect(missing.statusCode).toBe(400);
    expect(d.upsertInstall).not.toHaveBeenCalled();
  });

  it("persists a diagnosable pending install when consent is declined with a reported tenant", async () => {
    const d = deps();
    const state = signedState();
    const response = await handleMsteamsInstallComplete(
      event(
        `error=access_denied&error_description=declined&tenant=entra-1&state=${encodeURIComponent(
          state,
        )}`,
      ),
      d,
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body ?? "{}");
    expect(body.installed).toBe(false);
    expect(body.consent).toBe("admin_required");
    expect(d.upsertInstall).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      entraTenantId: "entra-1",
      botAppId: "app-1",
      installedByUserId: "admin-1",
    });
    expect(d.markConsentStatus).toHaveBeenCalledWith({
      entraTenantId: "entra-1",
      consentStatus: "admin_required",
    });
    expect(d.activateInstall).not.toHaveBeenCalled();
    expect(d.verifyConsent).not.toHaveBeenCalled();
  });

  it("never mutates on a forged error callback when the install is already active", async () => {
    const d = deps({
      getInstallStatus: vi
        .fn()
        .mockResolvedValue([{ entra_tenant_id: "entra-1", status: "active" }]),
    });
    const state = signedState();
    const response = await handleMsteamsInstallComplete(
      event(
        `error=access_denied&tenant=entra-1&state=${encodeURIComponent(state)}`,
      ),
      d,
    );

    // Still 200 and diagnosable, but the working binding is untouched.
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}").consent).toBe("admin_required");
    expect(d.upsertInstall).not.toHaveBeenCalled();
    expect(d.markConsentStatus).not.toHaveBeenCalled();
    expect(d.activateInstall).not.toHaveBeenCalled();
    expect(d.verifyConsent).not.toHaveBeenCalled();
  });

  it("reports declined consent without persisting when Microsoft omits the tenant", async () => {
    const d = deps();
    const state = signedState();
    const response = await handleMsteamsInstallComplete(
      event(`error=access_denied&state=${encodeURIComponent(state)}`),
      d,
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}").consent).toBe("admin_required");
    expect(d.upsertInstall).not.toHaveBeenCalled();
    expect(d.markConsentStatus).not.toHaveBeenCalled();
    expect(d.verifyConsent).not.toHaveBeenCalled();
  });

  it("keeps the declined-consent response diagnosable when the Entra tenant is bound elsewhere", async () => {
    const d = deps({
      upsertInstall: vi
        .fn()
        .mockRejectedValue(new MsteamsTenantConflictError("entra-1")),
    });
    const state = signedState();
    const response = await handleMsteamsInstallComplete(
      event(
        `error=access_denied&tenant=entra-1&state=${encodeURIComponent(state)}`,
      ),
      d,
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}").consent).toBe("admin_required");
    expect(d.markConsentStatus).not.toHaveBeenCalled();
  });

  it("rejects a callback without admin_consent=True", async () => {
    const d = deps();
    const state = signedState();
    const response = await handleMsteamsInstallComplete(
      event(`tenant=entra-1&state=${encodeURIComponent(state)}`),
      d,
    );
    expect(response.statusCode).toBe(400);
    expect(d.upsertInstall).not.toHaveBeenCalled();
  });

  it("guards the method", async () => {
    const response = await handleMsteamsInstallComplete(
      event("", "POST"),
      deps(),
    );
    expect(response.statusCode).toBe(405);
  });

  it("never returns or logs the client_secret or signed state", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const state = signedState();
    const response = await handleMsteamsInstallComplete(
      event(
        `admin_consent=True&tenant=entra-1&state=${encodeURIComponent(state)}`,
      ),
      deps(),
    );

    expect(response.body).not.toContain(CREDENTIALS.clientSecret);
    expect(response.body).not.toContain(state);
    const logged = [logSpy, warnSpy, errorSpy]
      .flatMap((spy) => spy.mock.calls.flat())
      .map((value) => String(value))
      .join(" ");
    expect(logged).not.toContain(CREDENTIALS.clientSecret);
    expect(logged).not.toContain(state);
  });
});
