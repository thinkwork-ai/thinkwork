import { describe, expect, it, vi } from "vitest";
import {
  completeAgentCoreUserOAuth,
  getAgentCoreUserOAuth,
  resolveAgentCoreUserOAuthAccessToken,
} from "./agentcore-user-oauth.js";

function options(responses: Array<Record<string, unknown>>) {
  const send = vi.fn(async () => responses.shift() ?? {});
  return {
    send,
    options: {
      workloadName: "workload",
      credentialProviderName: "twenty",
      resource: "https://crm.example/mcp",
      returnUrl: "https://api.example/oauth/complete",
      scopes: ["api", "profile"],
      client: { send },
    },
  };
}

describe("AgentCore user federation", () => {
  it("returns the authorization URL and session without exposing a token", async () => {
    const deps = options([
      { workloadAccessToken: "workload-token" },
      {
        authorizationUrl: "https://crm.example/authorize",
        sessionUri: "session-1",
      },
    ]);
    await expect(
      getAgentCoreUserOAuth(
        { userId: "user-1", customState: "signed", forceAuthentication: true },
        deps.options,
      ),
    ).resolves.toEqual({
      status: "authorization_required",
      authorizationUrl: "https://crm.example/authorize",
      sessionUri: "session-1",
    });
    expect(deps.send).toHaveBeenCalledTimes(2);
  });

  it("resolves an existing exact-user grant", async () => {
    const deps = options([
      { workloadAccessToken: "workload-token" },
      { accessToken: "resource-token" },
    ]);
    await expect(
      resolveAgentCoreUserOAuthAccessToken("user-1", deps.options),
    ).resolves.toBe("resource-token");
  });

  it("fails closed while authorization is incomplete", async () => {
    const deps = options([
      { workloadAccessToken: "workload-token" },
      { sessionStatus: "IN_PROGRESS", sessionUri: "session-1" },
    ]);
    await expect(
      resolveAgentCoreUserOAuthAccessToken("user-1", deps.options),
    ).rejects.toThrow("grant is not connected");
  });

  it("binds completion to the canonical user id and session URI", async () => {
    const deps = options([{}]);
    await completeAgentCoreUserOAuth(
      { userId: "user-1", sessionUri: "session-1" },
      deps.options,
    );
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
});
