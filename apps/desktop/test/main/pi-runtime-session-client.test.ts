import { describe, expect, it, vi } from "vitest";
import {
  createPiRuntimeSessionPreparer,
  resolveCognitoIdToken,
} from "../../src/main/pi-runtime-session-client";
import type { DesktopEnvSnapshot } from "../../src/main/env";

const env: DesktopEnvSnapshot = {
  nodeEnv: "test",
  stage: "dev",
  desktopLocalPiEnabled: true,
  deepLinkScheme: null,
  rendererUrl: null,
  apiUrl: "https://api.test/",
  graphqlHttpUrl: null,
  graphqlUrl: null,
  graphqlWsUrl: null,
  sandboxFrameSrc: null,
  cognito: {
    userPoolId: "pool",
    clientId: "client",
    domain: "auth.test",
  },
};

describe("pi runtime session client", () => {
  it("resolves the active Cognito ID token from desktop storage keys", () => {
    expect(
      resolveCognitoIdToken(
        {
          "CognitoIdentityServiceProvider.client.LastAuthUser": "google_123",
          "CognitoIdentityServiceProvider.client.google_123.idToken":
            "id-token",
        },
        "client",
      ),
    ).toBe("id-token");
  });

  it("prepares a backend desktop runtime session with the Cognito token", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(_url).toBe("https://api.test/api/desktop/runtime-session");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer id-token",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        agentId: "agent-1",
        threadId: "thread-1",
        userMessage: "hello",
      });
      return new Response(
        JSON.stringify({
          ok: true,
          session: {
            threadTurnId: "turn-1",
            expiresAt: "2026-05-28T13:00:00.000Z",
            finalizeCallbackSecret: "dps_secret",
            sidecarCredentials: {},
            invocation: {
              tenant_id: "tenant-1",
              assistant_id: "agent-1",
              thread_id: "thread-1",
              runtime_host: "desktop-local",
            },
          },
        }),
        { status: 200 },
      );
    });
    const prepare = createPiRuntimeSessionPreparer({
      env,
      tokenSnapshot: () => ({
        "CognitoIdentityServiceProvider.client.LastAuthUser": "google_123",
        "CognitoIdentityServiceProvider.client.google_123.idToken": "id-token",
      }),
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      prepare({
        agentId: "agent-1",
        threadId: "thread-1",
        userMessage: "hello",
      }),
    ).resolves.toMatchObject({ threadTurnId: "turn-1" });
  });
});
