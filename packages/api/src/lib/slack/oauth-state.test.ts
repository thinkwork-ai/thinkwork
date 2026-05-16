import { describe, expect, it } from "vitest";
import {
  buildSlackAuthorizeUrl,
  createSlackInstallState,
  sanitizeSlackInstallReturnUrl,
  verifySlackInstallState,
} from "./oauth-state.js";

describe("Slack OAuth install state", () => {
  it("round-trips a signed tenant/admin payload", () => {
    const state = createSlackInstallState({
      tenantId: "tenant-1",
      adminUserId: "user-1",
      clientSecret: "client-secret",
      returnUrl: "https://admin.example.com/slack",
      nowMs: () => 1_000,
      nonce: "nonce-1",
    });

    expect(
      verifySlackInstallState(state, "client-secret", () => 2_000),
    ).toMatchObject({
      tenantId: "tenant-1",
      adminUserId: "user-1",
      nonce: "nonce-1",
      returnUrl: "https://admin.example.com/slack",
    });
  });

  it("rejects tampered and expired state tokens", () => {
    const state = createSlackInstallState({
      tenantId: "tenant-1",
      adminUserId: "user-1",
      clientSecret: "client-secret",
      nowMs: () => 1_000,
      nonce: "nonce-1",
    });

    expect(() =>
      verifySlackInstallState(`${state}x`, "client-secret", () => 2_000),
    ).toThrow(/malformed|invalid/);
    expect(() =>
      verifySlackInstallState(state, "client-secret", () => 1_000_000),
    ).toThrow(/expired/);
  });

  it("builds Slack authorize URLs with bot scopes and the callback URI", () => {
    const url = new URL(
      buildSlackAuthorizeUrl({
        clientId: "client-1",
        state: "state-1",
        redirectUri: "https://api.example.com/slack/oauth/install",
      }),
    );

    expect(url.hostname).toBe("slack.com");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://api.example.com/slack/oauth/install",
    );
    expect(url.searchParams.get("scope")).toContain("chat:write.customize");
  });

  it("accepts https and localhost return URLs only", () => {
    expect(
      sanitizeSlackInstallReturnUrl("https://admin.example.com/slack"),
    ).toBe("https://admin.example.com/slack");
    expect(sanitizeSlackInstallReturnUrl("http://localhost:5174/slack")).toBe(
      "http://localhost:5174/slack",
    );
    expect(() =>
      sanitizeSlackInstallReturnUrl("http://evil.example/slack"),
    ).toThrow(/https/);
  });
});
