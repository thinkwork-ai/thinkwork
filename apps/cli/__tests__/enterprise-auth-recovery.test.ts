import { describe, expect, it, vi } from "vitest";

import {
  buildIdentityRecoveryLink,
  requestIdentityRecoveryGrant,
} from "../src/commands/enterprise/auth-recovery.js";

describe("enterprise auth recovery", () => {
  it("issues a route-bound recovery request without sending a Cognito subject", async () => {
    const fetchApi = vi.fn().mockResolvedValue({
      startToken: "opaque-token",
      recipientChallenge: "12345678",
      expiresAt: "2026-07-19T00:30:00.000Z",
      routeKeys: ["google-web", "microsoft-web"],
    });

    const result = await requestIdentityRecoveryGrant(
      {
        stage: "prod",
        tenantId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        redirectUri: "https://app.thinkwork.ai/auth/callback",
      },
      {
        resolveApi: () => ({
          apiUrl: "https://api.example.com",
          authSecret: "secret",
        }),
        fetchApi,
      },
    );

    expect(result.recipientChallenge).toBe("12345678");
    expect(fetchApi).toHaveBeenCalledWith(
      "https://api.example.com",
      "secret",
      "/api/auth/enrollment/recover",
      {
        method: "POST",
        body: JSON.stringify({
          tenantId: "11111111-1111-4111-8111-111111111111",
          userId: "22222222-2222-4222-8222-222222222222",
          redirectUri: "https://app.thinkwork.ai/auth/callback",
        }),
      },
    );
    expect(fetchApi.mock.calls[0]?.[3]?.body).not.toContain("cognito");
  });

  it("builds a recovery link on the same origin as the admitted callback", () => {
    expect(
      buildIdentityRecoveryLink(
        "https://app.thinkwork.ai/auth/callback",
        "opaque token",
      ),
    ).toBe("https://app.thinkwork.ai/accept-invite?token=opaque+token");
  });
});
