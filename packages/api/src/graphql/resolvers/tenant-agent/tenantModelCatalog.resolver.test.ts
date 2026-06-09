import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireTenantAdmin,
  mockResolveCaller,
  mockListTenantModelCatalog,
  mockListTenantModelCatalogByIds,
  mockGetTenantModelCatalogEntry,
  mockUpdateTenantModelCatalogEntry,
  mockUpsertTenantModelCatalogEntry,
  mockListBedrockCatalogModels,
  mockFetchBedrockPriceList,
  mockResolveBedrockPricingFromPriceList,
} = vi.hoisted(() => ({
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCaller: vi.fn(),
  mockListTenantModelCatalog: vi.fn(),
  mockListTenantModelCatalogByIds: vi.fn(),
  mockGetTenantModelCatalogEntry: vi.fn(),
  mockUpdateTenantModelCatalogEntry: vi.fn(),
  mockUpsertTenantModelCatalogEntry: vi.fn(),
  mockListBedrockCatalogModels: vi.fn(),
  mockFetchBedrockPriceList: vi.fn(),
  mockResolveBedrockPricingFromPriceList: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: mockResolveCaller,
}));

vi.mock("../../../lib/model-catalog/tenant-catalog.js", () => ({
  listTenantModelCatalog: mockListTenantModelCatalog,
  listTenantModelCatalogByIds: mockListTenantModelCatalogByIds,
  getTenantModelCatalogEntry: mockGetTenantModelCatalogEntry,
  updateTenantModelCatalogEntry: mockUpdateTenantModelCatalogEntry,
  upsertTenantModelCatalogEntry: mockUpsertTenantModelCatalogEntry,
}));

vi.mock("../../../lib/model-catalog/aws-bedrock-catalog.js", () => ({
  listBedrockCatalogModels: mockListBedrockCatalogModels,
}));

vi.mock("../../../lib/model-catalog/aws-price-list.js", () => ({
  fetchBedrockPriceList: mockFetchBedrockPriceList,
  resolveBedrockPricingFromPriceList: mockResolveBedrockPricingFromPriceList,
}));

import { bedrockModelImportCandidates } from "./bedrockModelImportCandidates.query.js";
import { importTenantBedrockModels } from "./importTenantBedrockModels.mutation.js";
import { tenantModelCatalog } from "./tenantModelCatalog.query.js";
import { updateTenantModelCatalogEntry } from "./updateTenantModelCatalogEntry.mutation.js";

const ctx = {
  auth: { authType: "cognito", principalId: "user-1", tenantId: "tenant-1" },
} as any;

const bedrockModel = {
  provider: "bedrock",
  providerName: "Anthropic",
  modelName: "Claude Sonnet 4.6",
  modelId: "us.anthropic.claude-sonnet-4-6",
  inputModalities: ["TEXT"],
  outputModalities: ["TEXT"],
  supportsStreaming: true,
  supportsVision: false,
  supportsTools: true,
  customizationsSupported: [],
  inferenceTypesSupported: ["ON_DEMAND"],
  lifecycleStatus: "ACTIVE",
  raw: {},
};

const resolvedPricing = {
  status: "resolved",
  inputCostPerMillion: "3.0000",
  outputCostPerMillion: "15.0000",
  pricingSource: "aws-price-list",
  diagnostics: { matchingSkus: ["sku-1"] },
};

const unresolvedTenantRow = {
  tenantId: "tenant-1",
  modelId: "us.anthropic.claude-sonnet-4-6",
  displayName: "Tenant Sonnet",
  inputCostPerMillion: null,
  outputCostPerMillion: null,
  pricingStatus: "missing",
  enabled: false,
};

describe("tenant model catalog resolvers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireTenantAdmin.mockResolvedValue("admin");
    mockResolveCaller.mockResolvedValue({
      userId: "user-1",
      tenantId: "tenant-1",
    });
    mockListTenantModelCatalog.mockResolvedValue([]);
    mockListTenantModelCatalogByIds.mockResolvedValue([]);
    mockGetTenantModelCatalogEntry.mockResolvedValue(null);
    mockUpdateTenantModelCatalogEntry.mockResolvedValue(null);
    mockUpsertTenantModelCatalogEntry.mockResolvedValue(undefined);
    mockListBedrockCatalogModels.mockResolvedValue([bedrockModel]);
    mockFetchBedrockPriceList.mockResolvedValue(["price-json"]);
    mockResolveBedrockPricingFromPriceList.mockReturnValue(resolvedPricing);
  });

  it("lists tenant catalog rows behind the tenant admin gate", async () => {
    mockListTenantModelCatalog.mockResolvedValue([
      { modelId: "model-1", displayName: "Tenant Model" },
    ]);

    await expect(
      tenantModelCatalog(
        null,
        { tenantId: "tenant-1", includeDisabled: true },
        ctx,
      ),
    ).resolves.toEqual([{ modelId: "model-1", displayName: "Tenant Model" }]);

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(mockListTenantModelCatalog).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      includeDisabled: true,
    });
  });

  it("returns Bedrock import candidates with AWS pricing and import state", async () => {
    mockListTenantModelCatalog.mockResolvedValue([
      {
        modelId: "us.anthropic.claude-sonnet-4-6",
        displayName: "Tenant Sonnet",
        enabled: true,
      },
    ]);

    const rows = await bedrockModelImportCandidates(
      null,
      { tenantId: "tenant-1" },
      ctx,
    );

    expect(rows).toEqual([
      expect.objectContaining({
        provider: "bedrock",
        modelId: "us.anthropic.claude-sonnet-4-6",
        displayName: "Tenant Sonnet",
        inputCostPerMillion: "3.0000",
        outputCostPerMillion: "15.0000",
        pricingStatus: "resolved",
        alreadyImported: true,
        enabled: true,
      }),
    ]);
    expect(mockResolveBedrockPricingFromPriceList).toHaveBeenCalledWith(
      ["price-json"],
      expect.objectContaining({
        modelId: "us.anthropic.claude-sonnet-4-6",
        modelName: "Claude Sonnet 4.6",
        providerName: "Anthropic",
      }),
    );
  });

  it("imports selected Bedrock models and enables only resolved-priced rows", async () => {
    mockListTenantModelCatalogByIds.mockResolvedValue([
      { modelId: "us.anthropic.claude-sonnet-4-6", enabled: true },
    ]);

    const rows = await importTenantBedrockModels(
      null,
      {
        input: {
          tenantId: "tenant-1",
          models: [
            {
              modelId: "us.anthropic.claude-sonnet-4-6",
              displayName: "Executive Sonnet",
              enabled: true,
            },
            {
              modelId: "us.anthropic.claude-sonnet-4-6",
              displayName: "Duplicate Sonnet",
              enabled: true,
            },
          ],
        },
      },
      ctx,
    );

    expect(rows).toEqual([
      { modelId: "us.anthropic.claude-sonnet-4-6", enabled: true },
    ]);
    expect(mockUpsertTenantModelCatalogEntry).toHaveBeenCalledTimes(1);
    expect(mockUpsertTenantModelCatalogEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        modelId: "us.anthropic.claude-sonnet-4-6",
        displayName: "Executive Sonnet",
        enabled: true,
        pricingStatus: "resolved",
        importedByUserId: "user-1",
      }),
    );
  });

  it("imports with disabled state when AWS pricing cannot be resolved", async () => {
    mockResolveBedrockPricingFromPriceList.mockReturnValue({
      status: "missing",
      inputCostPerMillion: null,
      outputCostPerMillion: null,
      pricingSource: "aws-price-list",
      diagnostics: { reason: "no_matching_price_list_products" },
    });

    await importTenantBedrockModels(
      null,
      {
        input: {
          tenantId: "tenant-1",
          models: [
            {
              modelId: "us.anthropic.claude-sonnet-4-6",
              enabled: true,
            },
          ],
        },
      },
      ctx,
    );

    expect(mockUpsertTenantModelCatalogEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        pricingStatus: "missing",
        inputCostPerMillion: null,
        outputCostPerMillion: null,
      }),
    );
  });

  it("rejects enabling tenant rows without resolved token pricing", async () => {
    mockGetTenantModelCatalogEntry.mockResolvedValue(unresolvedTenantRow);

    await expect(
      updateTenantModelCatalogEntry(
        null,
        {
          input: {
            tenantId: "tenant-1",
            modelId: "us.anthropic.claude-sonnet-4-6",
            enabled: true,
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "MODEL_PRICING_UNRESOLVED" },
    });

    expect(mockUpdateTenantModelCatalogEntry).not.toHaveBeenCalled();
  });
});
