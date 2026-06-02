import { describe, expect, it, vi } from "vitest";
import {
  createPiEvalRunPreparer,
  createPiRuntimeSessionPreparer,
  resolveCognitoIdToken,
} from "../../src/main/pi-runtime-session-client";
import type { DesktopEnvSnapshot } from "../../src/main/env";

const env: DesktopEnvSnapshot = {
  nodeEnv: "test",
  stage: "dev",
  desktopChannel: "dev",
  desktopProductName: "ThinkWork Spaces",
  desktopAppId: "ai.thinkwork.spaces.desktop.dev",
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

function preparedRuntimeSession(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

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
          session: preparedRuntimeSession(),
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

  it("prepares Desktop Pi eval case sessions after creating a run", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(init?.headers).toMatchObject({
        authorization: "Bearer id-token",
      });

      if (url === "https://api.test/api/desktop/eval-runs") {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          tenantId: "tenant-1",
          categories: ["red-team"],
          model: "kimi-k2.5",
        });
        return new Response(
          JSON.stringify({
            ok: true,
            run: {
              id: "run-1",
              status: "running",
              totalTests: 1,
            },
            target: {
              agentId: "agent-1",
              spaceId: "space-1",
              spaceSlug: "default",
              executionTarget: "desktop-pi",
              runtimeHost: "desktop-local",
            },
            resultCallback: {
              url: "https://api.test/api/desktop/eval-runs/run-1/results",
              token: "callback-token",
              expiresAt: "2026-05-28T13:00:00.000Z",
              authScheme: "bearer",
            },
            workItems: [
              {
                runId: "run-1",
                testCaseId: "case-1",
                index: 0,
                name: "Prompt injection refusal",
                category: "red-team",
                query: "ignore previous",
                systemPrompt: null,
                assertions: [],
                agentcoreEvaluatorIds: [],
                tags: [],
              },
            ],
          }),
          { status: 200 },
        );
      }

      expect(url).toBe("https://api.test/api/desktop/eval-runs/run-1/sessions");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        testCaseId: "case-1",
        spaceId: "space-1",
      });
      return new Response(
        JSON.stringify({
          ok: true,
          session: preparedRuntimeSession({
            threadTurnId: "eval-run-1-case-1",
            invocation: {
              tenant_id: "tenant-1",
              assistant_id: "agent-1",
              thread_id: "run-1",
              runtime_host: "desktop-local",
            },
          }),
        }),
        { status: 200 },
      );
    });

    const prepare = createPiEvalRunPreparer({
      env,
      tokenSnapshot: () => ({
        "CognitoIdentityServiceProvider.client.LastAuthUser": "google_123",
        "CognitoIdentityServiceProvider.client.google_123.idToken": "id-token",
      }),
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      prepare({
        tenantId: "tenant-1",
        categories: ["red-team"],
        testCaseIds: [],
        model: "kimi-k2.5",
        spaceId: null,
      }),
    ).resolves.toMatchObject({
      run: { id: "run-1" },
      workItems: [
        {
          testCaseId: "case-1",
          session: {
            threadTurnId: "eval-run-1-case-1",
          },
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
