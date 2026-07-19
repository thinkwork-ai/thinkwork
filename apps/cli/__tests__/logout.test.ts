import { describe, expect, it, vi } from "vitest";
import type { CognitoSession } from "../src/cli-config.js";
import { revokeCliCognitoSession } from "../src/commands/logout.js";

const session: CognitoSession = {
  kind: "cognito",
  idToken: "id-token",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: 123,
  userPoolId: "pool",
  userPoolClientId: "route-client",
  cognitoDomain: "thinkwork-dev",
  region: "us-east-1",
  principalId: "user-1",
};

describe("revokeCliCognitoSession", () => {
  it("uses the authenticated server endpoint without exposing the app client", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(
      revokeCliCognitoSession(session, "https://api.example.com/", fetchImpl),
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/revoke",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "id-token",
        },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      }),
    );
  });

  it("reports an offline revocation without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      revokeCliCognitoSession(session, "https://api.example.com", fetchImpl),
    ).resolves.toBe(false);
  });
});
