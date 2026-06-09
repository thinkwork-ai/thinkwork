import { describe, expect, it, vi } from "vitest";

import {
  getTenantModelPricing,
  listTenantModelCatalog,
} from "./tenant-catalog.js";

const resolvedRow = {
  id: "catalog-1",
  tenantId: "tenant-1",
  modelId: "us.anthropic.claude-sonnet-4-6",
  provider: "bedrock",
  displayName: "Tenant Sonnet",
  canonicalDisplayName: "Claude Sonnet 4.6",
  inputCostPerMillion: "3.0000",
  outputCostPerMillion: "15.0000",
  contextWindow: 200000,
  maxOutputTokens: 8192,
  supportsVision: true,
  supportsTools: true,
  enabled: true,
  pricingStatus: "resolved",
  pricingSource: "aws-price-list",
  pricingDiagnostics: { sku: "sku-1" },
  lastPricedAt: new Date("2026-06-09T00:00:00Z"),
  importSource: "aws-bedrock-catalog",
  importPayload: { lifecycleStatus: "ACTIVE" },
  importedByUserId: "user-1",
  importedAt: new Date("2026-06-09T00:00:00Z"),
  createdAt: new Date("2026-06-09T00:00:00Z"),
  updatedAt: new Date("2026-06-09T00:00:00Z"),
};

function createMockDb(selectResults: unknown[][]) {
  const db = {
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => selectResults.shift() ?? []),
        orderBy: vi.fn(async () => selectResults.shift() ?? []),
      };
      return chain;
    }),
  };
  return db as any;
}

describe("tenant model catalog service", () => {
  it("lists tenant display names with global model metadata", async () => {
    const db = createMockDb([[resolvedRow]]);

    const rows = await listTenantModelCatalog({ tenantId: "tenant-1" }, { db });

    expect(rows).toEqual([
      expect.objectContaining({
        id: "catalog-1",
        tenantId: "tenant-1",
        modelId: "us.anthropic.claude-sonnet-4-6",
        displayName: "Tenant Sonnet",
        canonicalDisplayName: "Claude Sonnet 4.6",
        enabled: true,
        pricingStatus: "resolved",
      }),
    ]);
  });

  it("returns tenant pricing only for resolved enabled catalog rows", async () => {
    const db = createMockDb([[resolvedRow]]);

    await expect(
      getTenantModelPricing(
        { tenantId: "tenant-1", modelId: "us.anthropic.claude-sonnet-4-6" },
        { db },
      ),
    ).resolves.toEqual({
      inputPerMillion: 3,
      outputPerMillion: 15,
      source: "tenant_model_catalog",
    });
  });

  it("does not price missing or disabled tenant catalog rows", async () => {
    const db = createMockDb([
      [{ ...resolvedRow, enabled: false, pricingStatus: "missing" }],
    ]);

    await expect(
      getTenantModelPricing(
        { tenantId: "tenant-1", modelId: "us.anthropic.claude-opus" },
        { db },
      ),
    ).resolves.toBeNull();
  });
});
