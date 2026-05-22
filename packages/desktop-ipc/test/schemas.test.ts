import { describe, expect, it, beforeEach } from "vitest";
import {
  ChannelSchemas,
  DeepLinkCallbackSchema,
  UpdateStateSchema,
  UpdateStatusSchema,
  assertSafeSenderFrame,
  rateLimit,
  resetRateLimits,
  type UpdateState,
} from "../src/index";

const arch = {
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
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
    expect(ChannelSchemas.startOAuth.response.parse(undefined)).toBeUndefined();
    expect(ChannelSchemas.signOut.request.parse(undefined)).toBeUndefined();
    expect(ChannelSchemas.signOut.response.parse(undefined)).toBeUndefined();

    expect(
      ChannelSchemas.consumePendingOAuth.response.parse({
        code: "abc",
        state: "xyz",
      }),
    ).toEqual({ code: "abc", state: "xyz" });

    expect(
      ChannelSchemas.getUpdateState.response.parse({
        status: "up-to-date",
        arch,
        version: "1.0.0",
      }),
    ).toEqual({ status: "up-to-date", arch, version: "1.0.0" });

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
  });

  it("rejects empty objects where fields are required", () => {
    expect(() => ChannelSchemas.getSessionTokens.response.parse({})).toThrow();
    expect(() => ChannelSchemas.getUpdateState.response.parse({})).toThrow();
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
      const state: UpdateState = { status, arch };
      expect(UpdateStateSchema.parse(state)).toEqual(state);
    }
  });

  it("keeps the deep-link callback schema strict", () => {
    expect(DeepLinkCallbackSchema.parse({ code: "abc", state: "xyz" })).toEqual(
      {
        code: "abc",
        state: "xyz",
      },
    );
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
