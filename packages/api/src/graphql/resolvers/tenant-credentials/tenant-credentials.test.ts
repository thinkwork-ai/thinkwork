import { describe, expect, it } from "vitest";
import {
  assertKnownKind,
  assertKnownStatus,
  credentialToGraphql,
  normalizeSlug,
  slugFromDisplayName,
} from "./shared";
import { normalizeCredentialSecret } from "../../../lib/tenant-credentials/secret-store";

describe("tenant credential resolver helpers", () => {
  it("normalizes display names into stable slugs", () => {
    expect(slugFromDisplayName("PDI Fuel Orders API")).toBe(
      "pdi-fuel-orders-api",
    );
    expect(normalizeSlug("  PDI / Fuel Orders  ")).toBe("pdi-fuel-orders");
  });

  it("rejects unsupported kind and status values before hitting the database", () => {
    expect(() => assertKnownKind("oauth_user")).toThrow(/Unsupported/);
    expect(() => assertKnownStatus("revealed")).toThrow(/Unsupported/);
  });

  it("accepts the routine-repo kind and enforces its required fields", () => {
    expect(() => assertKnownKind("github_repo")).not.toThrow();
    expect(() =>
      normalizeCredentialSecret("github_repo", {
        repoUrl: "https://github.com/acme/routines",
        token: "ghp_x",
        branch: "main",
      }),
    ).not.toThrow();
    expect(() =>
      normalizeCredentialSecret("github_repo", {
        repoUrl: "https://github.com/acme/routines",
        token: "ghp_x",
      }),
    ).toThrow(/branch/);
  });

  it("removes secret_ref from GraphQL output while preserving metadata", () => {
    const result = credentialToGraphql({
      id: "cred-1",
      tenant_id: "tenant-1",
      display_name: "PDI",
      slug: "pdi",
      kind: "soap_partner",
      status: "active",
      secret_ref: "arn:secret",
      metadata_json: { purpose: "fuel-orders" },
      schema_json: {},
      created_at: new Date("2026-05-04T12:00:00Z"),
      updated_at: new Date("2026-05-04T12:00:00Z"),
    }) as Record<string, unknown>;

    expect(result.secretRef).toBeUndefined();
    expect(result.metadataJson).toBe('{"purpose":"fuel-orders"}');
    expect(result.createdAt).toBe("2026-05-04T12:00:00.000Z");
  });
});
