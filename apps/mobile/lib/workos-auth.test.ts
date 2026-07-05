import { describe, expect, it, vi } from "vitest";
import type { PublicOAuthOption } from "./auth-options";
import {
  buildWorkosAuthorizeUrl,
  exchangeWorkosBridgeCode,
  parseWorkosCallbackParams,
  parseWorkosCallbackUrl,
  WorkosAuthError,
} from "./workos-auth";

describe("WorkOS mobile auth helpers", () => {
  it("builds the WorkOS authorize URL with the exact mobile redirect", () => {
    const url = buildWorkosAuthorizeUrl(
      option(),
      "https://api.customer.example.com/",
    );

    expect(url).toContain(
      "redirect_uri=thinkwork%3A%2F%2Foauth%2Fcallback",
    );
    expect(url).toBe(
      "https://api.customer.example.com/api/auth/workos/authorize?redirect_uri=thinkwork%3A%2F%2Foauth%2Fcallback",
    );
    expect(new URL(url).searchParams.get("redirect_uri")).toBe(
      "thinkwork://oauth/callback",
    );
  });

  it("passes through the optional WorkOS prompt", () => {
    const url = buildWorkosAuthorizeUrl(
      option({ prompt: "connection-id" }),
      "https://api.customer.example.com",
    );

    expect(new URL(url).searchParams.get("prompt")).toBe("connection-id");
  });

  it("parses a clean callback URL", () => {
    expect(
      parseWorkosCallbackUrl(
        "thinkwork://oauth/callback?workos_bridge=bridge-123&next=%2F",
      ),
    ).toEqual({ bridgeCode: "bridge-123", next: "/" });
  });

  it("parses callback URLs with unrelated params before and after the bridge code", () => {
    expect(
      parseWorkosCallbackUrl(
        "thinkwork://oauth/callback?utm=one&next=%2Fsettings&workos_bridge=bridge-456&extra=two",
      ),
    ).toEqual({ bridgeCode: "bridge-456", next: "/settings" });
  });

  it("ignores a trailing fragment while parsing the bridge code", () => {
    expect(
      parseWorkosCallbackUrl(
        "thinkwork://oauth/callback?next=%2Fhome&workos_bridge=bridge-789#ignored",
      ),
    ).toEqual({ bridgeCode: "bridge-789", next: "/home" });
  });

  it("throws a clear error when the callback URL has no bridge code", () => {
    expect(() =>
      parseWorkosCallbackUrl("thinkwork://oauth/callback?next=%2F"),
    ).toThrow(WorkosAuthError);
    expect(() =>
      parseWorkosCallbackUrl("thinkwork://oauth/callback?next=%2F"),
    ).toThrow(/no workos bridge code/i);
  });

  it("parses bridge params from an Expo Router param object", () => {
    expect(
      parseWorkosCallbackParams({
        workos_bridge: ["bridge-param"],
        next: ["/threads"],
      }),
    ).toEqual({ bridgeCode: "bridge-param", next: "/threads" });
  });

  it("exchanges a bridge code for Cognito-shaped tokens", async () => {
    const fetchMock = vi.fn(async () => response(200, tokens()));

    await expect(
      exchangeWorkosBridgeCode(
        "bridge-code",
        "https://api.customer.example.com/",
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toEqual(tokens());

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.customer.example.com/api/auth/workos/bridge",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ bridge_code: "bridge-code" }),
      }),
    );
  });

  it("surfaces expired or reused bridge codes as a user-presentable error", async () => {
    const fetchMock = vi.fn(async () =>
      response(400, { error: "bridge expired" }),
    );

    await expect(
      exchangeWorkosBridgeCode(
        "expired",
        "https://api.customer.example.com",
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/expired or already used/i);
  });

  it("rejects malformed successful bridge responses", async () => {
    const fetchMock = vi.fn(async () =>
      response(200, { id_token: "id-token", access_token: "access-token" }),
    );

    await expect(
      exchangeWorkosBridgeCode(
        "bridge-code",
        "https://api.customer.example.com",
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/unable to complete sign-in/i);
  });
});

function option(route: { prompt?: string } = {}): PublicOAuthOption {
  return {
    key: "workos",
    label: "SSO",
    icon: "sso",
    provider: "workos",
    providerSpecific: true,
    route: {
      type: "workosAuthorize",
      authorizePath: "/api/auth/workos/authorize",
      ...route,
    },
  };
}

function tokens() {
  return {
    id_token: "id-token",
    access_token: "access-token",
    refresh_token: "refresh-token",
  };
}

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
