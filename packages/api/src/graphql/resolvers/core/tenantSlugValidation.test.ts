/**
 * Plan 2026-06-12-002 U5 — signup-path namespace check.
 *
 * validateTenantSlug's Cloudflare leg: ANY record at <slug>.thinkwork.ai
 * → SLUG_UNAVAILABLE (R1), with no comment/owner leakage (R5); Cloudflare
 * API errors fail CLOSED; a missing token CONFIG (vs lookup failure) logs
 * loudly and skips the leg (ship-inert carve-out for pre-token stages).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatClaimComment,
  CloudflareApiError,
  type DnsRecord,
} from "@thinkwork/namespace-registry";
import { CloudflareNamespaceTokenError } from "../../../lib/cloudflare-namespace-token.js";
import {
  __setNamespaceCheckDepsForTests,
  validateTenantSlug,
} from "./tenantSlugValidation.js";

const resolveToken = vi.fn<() => Promise<string | null>>();
const listRecords = vi.fn<(fqdn: string) => Promise<DnsRecord[]>>();
const createDns = vi.fn((_token: string) => ({ listRecords }));

function deploymentNsRecord(slug: string): DnsRecord {
  return {
    id: "rec-1",
    type: "NS",
    name: `${slug}.thinkwork.ai`,
    content: "ns-123.awsdns-01.com",
    comment: formatClaimComment({
      kind: "deployment",
      owner: "tei-deploy",
      created: "2026-06-12",
    }),
  };
}

describe("validateTenantSlug namespace check", () => {
  beforeEach(() => {
    resolveToken.mockReset().mockResolvedValue("cf-token");
    listRecords.mockReset().mockResolvedValue([]);
    createDns.mockClear();
    __setNamespaceCheckDepsForTests({ resolveToken, createDns });
  });

  afterEach(() => {
    __setNamespaceCheckDepsForTests(null);
    vi.restoreAllMocks();
  });

  it("passes a free slug and queries the right FQDN", async () => {
    await expect(validateTenantSlug("acme")).resolves.toBeUndefined();
    expect(listRecords).toHaveBeenCalledWith("acme.thinkwork.ai");
    expect(createDns).toHaveBeenCalledWith("cf-token");
  });

  it("rejects a deployment-claimed slug with SLUG_UNAVAILABLE (AE1)", async () => {
    listRecords.mockResolvedValue([deploymentNsRecord("tei")]);

    await expect(validateTenantSlug("tei")).rejects.toMatchObject({
      extensions: { code: "SLUG_UNAVAILABLE" },
    });
  });

  it("never leaks record comments or owner identity in SLUG_UNAVAILABLE (R5)", async () => {
    const record = deploymentNsRecord("tei");
    listRecords.mockResolvedValue([record]);

    const error = await validateTenantSlug("tei").then(
      () => {
        throw new Error("expected validateTenantSlug to reject");
      },
      (err) => err,
    );

    const serialized = JSON.stringify({
      message: error.message,
      extensions: error.extensions,
    });
    expect(serialized).not.toContain("tei-deploy");
    expect(serialized).not.toContain("deployment:");
    expect(serialized).not.toContain(record.comment);
    expect(serialized).not.toContain(record.content);
  });

  it("rejects on ANY record, even with an unparseable comment (R1)", async () => {
    listRecords.mockResolvedValue([
      {
        id: "rec-2",
        type: "TXT",
        name: "acme.thinkwork.ai",
        content: "hand-created",
        comment: null,
      },
    ]);

    await expect(validateTenantSlug("acme")).rejects.toMatchObject({
      extensions: { code: "SLUG_UNAVAILABLE" },
    });
  });

  it.each(["canary", "api", "dev"])(
    "rejects reserved slug %s with NO Cloudflare call (AE2)",
    async (slug) => {
      await expect(validateTenantSlug(slug)).rejects.toMatchObject({
        extensions: { code: "RESERVED_SLUG" },
      });
      expect(resolveToken).not.toHaveBeenCalled();
      expect(listRecords).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid slug shapes with NO Cloudflare call", async () => {
    await expect(validateTenantSlug("-bad-")).rejects.toMatchObject({
      extensions: { code: "INVALID_SLUG" },
    });
    expect(resolveToken).not.toHaveBeenCalled();
    expect(listRecords).not.toHaveBeenCalled();
  });

  it("fails CLOSED on a Cloudflare API error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listRecords.mockRejectedValue(
      new CloudflareApiError({
        method: "GET",
        path: "/zones/z/dns_records",
        status: 500,
        errors: [],
        body: "internal error",
      }),
    );

    await expect(validateTenantSlug("acme")).rejects.toMatchObject({
      extensions: { code: "SLUG_VALIDATION_UNAVAILABLE" },
    });
  });

  it("fails CLOSED when the token LOOKUP fails (token may exist)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    resolveToken.mockRejectedValue(
      new CloudflareNamespaceTokenError(
        "/thinkwork/dev/cloudflare-namespace-token",
        new Error("AccessDenied"),
      ),
    );

    await expect(validateTenantSlug("acme")).rejects.toMatchObject({
      extensions: { code: "SLUG_VALIDATION_UNAVAILABLE" },
    });
    expect(listRecords).not.toHaveBeenCalled();
  });

  it("logs loudly and SKIPS the Cloudflare leg when no token is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveToken.mockResolvedValue(null);

    await expect(validateTenantSlug("acme")).resolves.toBeUndefined();

    expect(listRecords).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Cloudflare namespace check SKIPPED"),
    );
  });
});
