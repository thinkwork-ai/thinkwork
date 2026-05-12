import { describe, expect, it } from "vitest";
import { loadRunbooks } from "@thinkwork/runbooks";
import {
  buildRunbookCatalogSeedRows,
  getUnavailableCatalogSlugs,
} from "./catalog.js";

describe("runbook catalog helpers", () => {
  it("builds one active tenant-scoped catalog row per source runbook", () => {
    const rows = buildRunbookCatalogSeedRows({
      tenantId: "tenant-1",
      definitions: loadRunbooks(),
    });

    const slugs = rows.map((row) => row.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toEqual([...slugs].sort());
    expect(rows).toContainEqual(
      expect.objectContaining({
        tenant_id: "tenant-1",
        slug: "crm-dashboard",
        source_version: expect.any(String),
        status: "active",
        enabled: true,
      }),
    );
  });

  it("does not seed a global catalog when no assigned skill definitions are provided", () => {
    expect(buildRunbookCatalogSeedRows({ tenantId: "tenant-1" })).toEqual([]);
  });

  it("marks removed source runbooks unavailable without deleting history", () => {
    expect(
      getUnavailableCatalogSlugs({
        existingSlugs: [
          "crm-dashboard",
          "legacy-runbook",
          "research-dashboard",
        ],
        sourceSlugs: ["crm-dashboard", "research-dashboard"],
      }),
    ).toEqual(["legacy-runbook"]);
  });
});
