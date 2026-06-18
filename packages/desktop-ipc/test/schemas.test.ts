import { describe, expect, it, beforeEach } from "vitest";
import {
  ChannelSchemas,
  DeepLinkCallbackSchema,
  OpenThreadEventSchema,
  RaiseThreadNotificationRequestSchema,
  UpdateStateSchema,
  UpdateStatusSchema,
  UpdateTelemetryEventSchema,
  WindowFocusEventSchema,
  assertSafeSenderFrame,
  rateLimit,
  resetRateLimits,
  type UpdateState,
} from "../src/index";

const updateState = {
  status: "up-to-date",
  currentVersion: "1.0.0",
  availableVersion: null,
  downloadedVersion: null,
  downloadPercent: null,
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  checkedAt: "2026-05-22T00:00:00.000Z",
  message: null,
  errorContext: null,
  canRetry: false,
  channel: "latest",
};

describe("desktop IPC schemas", () => {
  it("parses valid examples for every channel", () => {
    expect(
      ChannelSchemas.getSessionTokens.request.parse(undefined),
    ).toBeUndefined();
    expect(
      ChannelSchemas.getSessionTokens.response.parse({
        items: {
          "CognitoIdentityServiceProvider.client.LastAuthUser": "user-id",
        },
        version: 1,
      }),
    ).toEqual({
      items: {
        "CognitoIdentityServiceProvider.client.LastAuthUser": "user-id",
      },
      version: 1,
    });
    expect(
      ChannelSchemas.setTokenStorageItem.request.parse({
        key: "token-key",
        value: "token-value",
      }),
    ).toEqual({ key: "token-key", value: "token-value" });
    expect(
      ChannelSchemas.setTokenStorageItem.response.parse(undefined),
    ).toBeUndefined();
    expect(
      ChannelSchemas.removeTokenStorageItem.request.parse({ key: "token-key" }),
    ).toEqual({ key: "token-key" });
    expect(
      ChannelSchemas.removeTokenStorageItem.response.parse(undefined),
    ).toBeUndefined();
    expect(
      ChannelSchemas.clearTokenStorage.request.parse(undefined),
    ).toBeUndefined();
    expect(
      ChannelSchemas.clearTokenStorage.response.parse(undefined),
    ).toBeUndefined();

    expect(ChannelSchemas.startOAuth.request.parse(undefined)).toBeUndefined();
    expect(ChannelSchemas.startOAuth.request.parse({ next: "/new" })).toEqual({
      next: "/new",
    });
    expect(
      ChannelSchemas.startOAuth.request.parse({
        next: "/new",
        provider: "Microsoft",
      }),
    ).toEqual({
      next: "/new",
      provider: "Microsoft",
    });
    expect(
      ChannelSchemas.startOAuth.response.parse({
        url: "https://auth.example/oauth2/authorize?state=xyz",
        state: "xyz",
      }),
    ).toEqual({
      url: "https://auth.example/oauth2/authorize?state=xyz",
      state: "xyz",
    });
    expect(ChannelSchemas.signOut.request.parse(undefined)).toBeUndefined();
    expect(
      ChannelSchemas.signOut.response.parse({
        ok: true,
        revokeFailed: false,
      }),
    ).toEqual({ ok: true, revokeFailed: false });

    expect(
      ChannelSchemas.consumePendingOAuth.response.parse({
        code: "abc",
        next: "/automations/123",
        state: "xyz",
      }),
    ).toEqual({ code: "abc", next: "/automations/123", state: "xyz" });
    expect(
      ChannelSchemas.importDeploymentProfile.request.parse({
        json: '{"schemaVersion":1}',
      }),
    ).toEqual({ json: '{"schemaVersion":1}' });
    expect(
      ChannelSchemas.importDeploymentProfile.response.parse({
        stage: "dev",
        configured: true,
        missing: [],
        oauthRedirectUri: "thinkwork-dev://oauth/callback",
        endpoints: {
          apiUrl: "https://api.example.com",
          graphqlHttpUrl: "https://api.example.com/graphql",
          graphqlUrl: "https://appsync.example.com/graphql",
          graphqlWsUrl: "wss://appsync.example.com/graphql",
          cognitoDomain: "https://auth.example.com",
        },
        deployment: {
          source: "profile",
          deploymentId: "acme-dev",
          displayName: "Acme ThinkWork",
          stage: "dev",
          region: "us-east-1",
          profileSha256: "abc123",
          trustStatus: "unsigned",
          trustLabel: "Unsigned development profile",
        },
      }),
    ).toMatchObject({
      deployment: {
        source: "profile",
        displayName: "Acme ThinkWork",
      },
    });
    expect(
      ChannelSchemas.removeDeploymentProfile.request.parse(undefined),
    ).toBeUndefined();

    expect(
      ChannelSchemas.getUpdateState.response.parse({
        ...updateState,
      }),
    ).toEqual(updateState);

    expect(
      ChannelSchemas.checkForUpdates.request.parse(undefined),
    ).toBeUndefined();
    expect(
      ChannelSchemas.checkForUpdates.response.parse(undefined),
    ).toBeUndefined();
    expect(
      ChannelSchemas.downloadUpdate.request.parse(undefined),
    ).toBeUndefined();
    expect(
      ChannelSchemas.downloadUpdate.response.parse(undefined),
    ).toBeUndefined();
    expect(
      ChannelSchemas.installUpdate.request.parse(undefined),
    ).toBeUndefined();
    expect(
      ChannelSchemas.installUpdate.response.parse(undefined),
    ).toBeUndefined();

    expect(
      ChannelSchemas.reportInstallOutcome.request.parse({
        version: "1.0.0",
        outcome: "installed",
      }),
    ).toEqual({ version: "1.0.0", outcome: "installed" });
    expect(
      ChannelSchemas.reportInstallOutcome.response.parse(undefined),
    ).toBeUndefined();

    expect(ChannelSchemas).not.toHaveProperty("getPiStatus");
    expect(ChannelSchemas).not.toHaveProperty("startPiTurn");
    expect(ChannelSchemas).not.toHaveProperty("prewarmPiWorkspace");
    expect(ChannelSchemas).not.toHaveProperty("startPiEvalRun");
  });

  it("rejects empty objects where fields are required", () => {
    expect(() => ChannelSchemas.getSessionTokens.response.parse({})).toThrow();
    expect(() => ChannelSchemas.getUpdateState.response.parse({})).toThrow();
    expect(() =>
      ChannelSchemas.startOAuth.request.parse({ next: "https://evil.example" }),
    ).toThrow();
    expect(() =>
      ChannelSchemas.reportInstallOutcome.request.parse({}),
    ).toThrow();
  });

  it("handles both pending and missing OAuth callbacks", () => {
    expect(
      ChannelSchemas.consumePendingOAuth.response.parse({
        code: "abc",
        state: "xyz",
      }),
    ).toEqual({ code: "abc", state: "xyz" });
    expect(ChannelSchemas.consumePendingOAuth.response.parse(null)).toBeNull();
  });

  it("accepts every update status", () => {
    for (const status of UpdateStatusSchema.options) {
      const state: UpdateState = { ...updateState, status };
      expect(UpdateStateSchema.parse(state)).toEqual(state);
    }
  });

  it("parses update telemetry events", () => {
    expect(
      UpdateTelemetryEventSchema.parse({
        type: "update.download_completed",
        version: "1.0.1",
        channel: "latest",
        fromVersion: "1.0.0",
      }),
    ).toEqual({
      type: "update.download_completed",
      version: "1.0.1",
      channel: "latest",
      fromVersion: "1.0.0",
    });
  });

  it("validates thread-notification channel payloads", () => {
    expect(
      ChannelSchemas.raiseThreadNotification.request.parse({
        threadId: "thread-1",
        title: "Scott",
        body: "hey there",
        count: 3,
      }),
    ).toEqual({
      threadId: "thread-1",
      title: "Scott",
      body: "hey there",
      count: 3,
    });
    expect(
      RaiseThreadNotificationRequestSchema.parse({
        threadId: "thread-1",
        title: "t",
        body: "b",
      }),
    ).toEqual({ threadId: "thread-1", title: "t", body: "b" });
    expect(
      ChannelSchemas.raiseThreadNotification.response.parse(undefined),
    ).toBeUndefined();
    expect(() =>
      RaiseThreadNotificationRequestSchema.parse({ title: "t", body: "b" }),
    ).toThrow();
    expect(() =>
      RaiseThreadNotificationRequestSchema.parse({
        threadId: "thread-1",
        title: "t",
        body: "b",
        count: 1.5,
      }),
    ).toThrow();
  });

  it("validates open-thread and window-focus events", () => {
    expect(OpenThreadEventSchema.parse({ threadId: "thread-1" })).toEqual({
      threadId: "thread-1",
    });
    expect(() => OpenThreadEventSchema.parse({ threadId: "" })).toThrow();
    expect(WindowFocusEventSchema.parse({ focused: true })).toEqual({
      focused: true,
    });
    expect(() => WindowFocusEventSchema.parse({ focused: "yes" })).toThrow();
  });

  it("keeps the deep-link callback schema strict", () => {
    expect(DeepLinkCallbackSchema.parse({ code: "abc", state: "xyz" })).toEqual(
      {
        code: "abc",
        state: "xyz",
      },
    );
    expect(
      DeepLinkCallbackSchema.parse({
        type: "deployment-profile",
        json: '{"schemaVersion":1}',
      }),
    ).toEqual({
      type: "deployment-profile",
      json: '{"schemaVersion":1}',
    });
    expect(
      DeepLinkCallbackSchema.parse({
        type: "app-route",
        path: "/settings/plugins/lastmile?pluginOAuth=success",
      }),
    ).toEqual({
      type: "app-route",
      path: "/settings/plugins/lastmile?pluginOAuth=success",
    });
    expect(() =>
      DeepLinkCallbackSchema.parse({
        code: "abc",
        state: "xyz",
        redirect: "https://evil.example",
      }),
    ).toThrow();
  });
});

describe("desktop IPC handler guards", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("allows trusted sender frames and rejects untrusted frames", () => {
    expect(() =>
      assertSafeSenderFrame({ senderFrame: { url: "thinkwork://app/" } }),
    ).not.toThrow();
    expect(() =>
      assertSafeSenderFrame({ senderFrame: { url: "https://evil.example/" } }),
    ).toThrow(/untrusted sender frame/);
  });

  it("allows the active Electron dev renderer URL", () => {
    const previousRendererUrl = process.env.ELECTRON_RENDERER_URL;
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5176/";
    try {
      expect(() =>
        assertSafeSenderFrame({
          senderFrame: { url: "http://localhost:5176/sign-in?next=%2Fnew" },
        }),
      ).not.toThrow();
    } finally {
      if (previousRendererUrl === undefined) {
        delete process.env.ELECTRON_RENDERER_URL;
      } else {
        process.env.ELECTRON_RENDERER_URL = previousRendererUrl;
      }
    }
  });

  it("rate-limits repeated calls by key", () => {
    expect(() =>
      rateLimit({ key: "start-oauth", intervalMs: 2_000, now: () => 1_000 }),
    ).not.toThrow();
    expect(() =>
      rateLimit({ key: "start-oauth", intervalMs: 2_000, now: () => 1_500 }),
    ).toThrow(/Rate limit exceeded/);
    expect(() =>
      rateLimit({ key: "start-oauth", intervalMs: 2_000, now: () => 3_000 }),
    ).not.toThrow();
  });
});
