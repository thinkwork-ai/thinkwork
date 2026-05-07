import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  computerRows: [
    {
      id: "computer-1",
      tenant_id: "tenant-1",
      owner_user_id: "user-1",
    },
  ],
  resolveConnectionForUser: vi.fn(),
  resolveOAuthToken: vi.fn(),
  resolveOAuthTokenDetails: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.computerRows,
        }),
      }),
    }),
  }),
}));

vi.mock("../oauth-token.js", () => ({
  resolveConnectionForUser: mocks.resolveConnectionForUser,
  resolveOAuthToken: mocks.resolveOAuthToken,
  resolveOAuthTokenDetails: mocks.resolveOAuthTokenDetails,
}));

import {
  checkGoogleWorkspaceConnection,
  resolveGoogleWorkspaceCliToken,
} from "./runtime-api.js";

describe("Computer runtime API Google Workspace status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.computerRows = [
      {
        id: "computer-1",
        tenant_id: "tenant-1",
        owner_user_id: "user-1",
      },
    ];
  });

  it("reports no active Google Workspace connection for the Computer owner", async () => {
    mocks.resolveConnectionForUser.mockResolvedValue(null);

    const result = await checkGoogleWorkspaceConnection({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(mocks.resolveConnectionForUser).toHaveBeenCalledWith(
      "tenant-1",
      "user-1",
      "google_productivity",
    );
    expect(result).toMatchObject({
      providerName: "google_productivity",
      connected: false,
      tokenResolved: false,
      reason: "no_active_connection",
    });
  });

  it("resolves a token without returning token material", async () => {
    mocks.resolveConnectionForUser.mockResolvedValue({
      connectionId: "connection-1",
      providerId: "provider-1",
    });
    mocks.resolveOAuthTokenDetails.mockResolvedValue({
      accessToken: "ya29.secret-token",
      grantedScopes: ["https://www.googleapis.com/auth/calendar"],
    });

    const result = await checkGoogleWorkspaceConnection({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(mocks.resolveOAuthTokenDetails).toHaveBeenCalledWith(
      "connection-1",
      "tenant-1",
      "provider-1",
    );
    expect(result).toMatchObject({
      providerName: "google_productivity",
      connected: true,
      tokenResolved: true,
      connectionId: "connection-1",
      calendarScopeGranted: true,
      missingScopes: [],
      reason: null,
    });
    expect(JSON.stringify(result)).not.toContain("ya29");
  });

  it("reports missing Google Calendar scope without returning token material", async () => {
    mocks.resolveConnectionForUser.mockResolvedValue({
      connectionId: "connection-1",
      providerId: "provider-1",
    });
    mocks.resolveOAuthTokenDetails.mockResolvedValue({
      accessToken: "ya29.secret-token",
      grantedScopes: ["openid", "email"],
    });

    const result = await checkGoogleWorkspaceConnection({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toMatchObject({
      connected: true,
      tokenResolved: true,
      calendarScopeGranted: false,
      missingScopes: ["https://www.googleapis.com/auth/calendar"],
    });
    expect(JSON.stringify(result)).not.toContain("ya29");
  });

  it("resolves a Google Workspace CLI token for service-auth runtime use", async () => {
    mocks.resolveConnectionForUser.mockResolvedValue({
      connectionId: "connection-1",
      providerId: "provider-1",
    });
    mocks.resolveOAuthTokenDetails.mockResolvedValue({
      accessToken: "ya29.secret-token",
      grantedScopes: ["openid"],
    });

    const result = await resolveGoogleWorkspaceCliToken({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toMatchObject({
      connected: true,
      tokenResolved: true,
      accessToken: "ya29.secret-token",
      connectionId: "connection-1",
      missingScopes: ["https://www.googleapis.com/auth/calendar"],
    });
  });

  it("returns safe CLI token status when no connection or token is available", async () => {
    mocks.resolveConnectionForUser.mockResolvedValueOnce(null);

    await expect(
      resolveGoogleWorkspaceCliToken({
        tenantId: "tenant-1",
        computerId: "computer-1",
      }),
    ).resolves.toMatchObject({
      connected: false,
      tokenResolved: false,
      reason: "no_active_connection",
    });

    mocks.resolveConnectionForUser.mockResolvedValueOnce({
      connectionId: "connection-1",
      providerId: "provider-1",
    });
    mocks.resolveOAuthTokenDetails.mockResolvedValueOnce(null);

    const result = await resolveGoogleWorkspaceCliToken({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toMatchObject({
      connected: true,
      tokenResolved: false,
      reason: "token_unavailable_or_expired",
    });
    expect(JSON.stringify(result)).not.toContain("accessToken");
  });
});
