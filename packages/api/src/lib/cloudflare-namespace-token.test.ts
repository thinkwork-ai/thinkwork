/**
 * Plan 2026-06-12-002 U5 (KTD7) — Lambda-side Cloudflare token resolution:
 * env fallback for local/test, SecureString SSM parameter in Lambda,
 * placeholder/missing → null (unconfigured), lookup failure → typed error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOUDFLARE_NAMESPACE_TOKEN_PLACEHOLDER,
  CloudflareNamespaceTokenError,
  __resetCloudflareNamespaceTokenCacheForTests,
  resolveCloudflareNamespaceToken,
} from "./cloudflare-namespace-token.js";

describe("resolveCloudflareNamespaceToken", () => {
  beforeEach(() => {
    __resetCloudflareNamespaceTokenCacheForTests();
    vi.stubEnv("CLOUDFLARE_NAMESPACE_API_TOKEN", "");
    vi.stubEnv("STAGE", "dev");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    __resetCloudflareNamespaceTokenCacheForTests();
  });

  it("prefers the env token (local/test fallback) without touching SSM", async () => {
    vi.stubEnv("CLOUDFLARE_NAMESPACE_API_TOKEN", "env-token");
    const ssmSend = vi.fn();

    await expect(resolveCloudflareNamespaceToken({ ssmSend })).resolves.toBe(
      "env-token",
    );
    expect(ssmSend).not.toHaveBeenCalled();
  });

  it("resolves the stage-scoped SecureString parameter", async () => {
    const ssmSend = vi.fn().mockResolvedValue("ssm-token");

    await expect(resolveCloudflareNamespaceToken({ ssmSend })).resolves.toBe(
      "ssm-token",
    );
    expect(ssmSend).toHaveBeenCalledWith(
      "/thinkwork/dev/cloudflare-namespace-token",
    );
  });

  it("caches the resolved token for the container lifetime", async () => {
    const ssmSend = vi.fn().mockResolvedValue("ssm-token");

    await resolveCloudflareNamespaceToken({ ssmSend });
    await resolveCloudflareNamespaceToken({ ssmSend });

    expect(ssmSend).toHaveBeenCalledTimes(1);
  });

  it("returns null without SSM when no stage identity exists", async () => {
    vi.stubEnv("STAGE", "");
    const ssmSend = vi.fn();

    await expect(
      resolveCloudflareNamespaceToken({ ssmSend }),
    ).resolves.toBeNull();
    expect(ssmSend).not.toHaveBeenCalled();
  });

  it("treats the terraform placeholder as unconfigured", async () => {
    const ssmSend = vi
      .fn()
      .mockResolvedValue(CLOUDFLARE_NAMESPACE_TOKEN_PLACEHOLDER);

    await expect(
      resolveCloudflareNamespaceToken({ ssmSend }),
    ).resolves.toBeNull();
  });

  it("treats a missing parameter (ParameterNotFound) as unconfigured", async () => {
    const ssmSend = vi.fn().mockRejectedValue(
      Object.assign(new Error("parameter missing"), {
        name: "ParameterNotFound",
      }),
    );

    await expect(
      resolveCloudflareNamespaceToken({ ssmSend }),
    ).resolves.toBeNull();
  });

  it("throws a typed error on any other SSM failure (fail-closed input)", async () => {
    const ssmSend = vi.fn().mockRejectedValue(new Error("AccessDenied"));

    await expect(
      resolveCloudflareNamespaceToken({ ssmSend }),
    ).rejects.toBeInstanceOf(CloudflareNamespaceTokenError);
  });

  it("does not cache lookup failures — the next call retries", async () => {
    const ssmSend = vi
      .fn()
      .mockRejectedValueOnce(new Error("AccessDenied"))
      .mockResolvedValueOnce("ssm-token");

    await expect(
      resolveCloudflareNamespaceToken({ ssmSend }),
    ).rejects.toBeInstanceOf(CloudflareNamespaceTokenError);
    await expect(resolveCloudflareNamespaceToken({ ssmSend })).resolves.toBe(
      "ssm-token",
    );
  });
});
