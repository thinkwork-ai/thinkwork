import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@thinkwork/ui";

const {
  queryDocs,
  useQueryMock,
  importModelsMock,
  updateCatalogEntryMock,
  catalogRows,
  candidateRows,
} = vi.hoisted(() => ({
  queryDocs: {
    SettingsBedrockModelImportCandidatesQuery: Symbol("bedrockCandidates"),
    SettingsImportTenantBedrockModelsMutation: Symbol("importModels"),
    SettingsTenantModelCatalogQuery: Symbol("tenantCatalog"),
    SettingsUpdateTenantModelCatalogEntryMutation: Symbol("updateCatalog"),
  },
  useQueryMock: vi.fn(),
  importModelsMock: vi.fn(),
  updateCatalogEntryMock: vi.fn(),
  catalogRows: [] as unknown[],
  candidateRows: [] as unknown[],
}));

vi.mock("urql", () => ({
  useMutation: (query: unknown) => {
    if (query === queryDocs.SettingsImportTenantBedrockModelsMutation) {
      return [{ fetching: false }, importModelsMock];
    }
    if (query === queryDocs.SettingsUpdateTenantModelCatalogEntryMutation) {
      return [{ fetching: false }, updateCatalogEntryMock];
    }
    return [{ fetching: false }, vi.fn()];
  },
  useQuery: useQueryMock,
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({
    tenant: { id: "tenant-1", slug: "thinkwork", name: "ThinkWork" },
    tenantId: "tenant-1",
    userId: "user-1",
  }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

import { SettingsModelCatalog } from "./SettingsModelCatalog";

function renderPage() {
  return render(
    <TooltipProvider>
      <SettingsModelCatalog />
    </TooltipProvider>,
  );
}

const resolvedModel = {
  tenantId: "tenant-1",
  modelId: "us.anthropic.claude-sonnet-4-6",
  provider: "bedrock",
  displayName: "Tenant Sonnet",
  canonicalDisplayName: "Claude Sonnet 4.6",
  inputCostPerMillion: 3,
  outputCostPerMillion: 15,
  contextWindow: 200000,
  maxOutputTokens: 8192,
  supportsVision: true,
  supportsTools: true,
  enabled: true,
  pricingStatus: "resolved",
  pricingSource: "aws-price-list",
  pricingDiagnostics: {},
  lastPricedAt: "2026-06-09T12:00:00.000Z",
  importSource: "aws-bedrock-catalog",
  importPayload: {},
  importedByUserId: "user-1",
  importedAt: "2026-06-09T12:00:00.000Z",
  createdAt: "2026-06-09T12:00:00.000Z",
  updatedAt: "2026-06-09T12:00:00.000Z",
};

const missingPriceModel = {
  ...resolvedModel,
  modelId: "amazon.titan-text-lite-v1",
  displayName: "Tenant Titan",
  canonicalDisplayName: "Titan Text Lite",
  inputCostPerMillion: null,
  outputCostPerMillion: null,
  enabled: false,
  pricingStatus: "missing",
};

const resolvedCandidate = {
  provider: "bedrock",
  providerName: "Anthropic",
  modelName: "Claude Sonnet 4.6",
  modelId: "us.anthropic.claude-sonnet-4-6",
  displayName: "Claude Sonnet 4.6",
  inputModalities: ["TEXT"],
  outputModalities: ["TEXT"],
  supportsStreaming: true,
  supportsVision: true,
  supportsTools: true,
  customizationsSupported: [],
  inferenceTypesSupported: ["ON_DEMAND"],
  lifecycleStatus: "ACTIVE",
  inputCostPerMillion: 3,
  outputCostPerMillion: 15,
  pricingStatus: "resolved",
  pricingSource: "aws-price-list",
  pricingDiagnostics: {},
  alreadyImported: false,
  enabled: false,
};

const missingCandidate = {
  ...resolvedCandidate,
  providerName: "Amazon",
  modelName: "Titan Text Lite",
  modelId: "amazon.titan-text-lite-v1",
  displayName: "Titan Text Lite",
  inputCostPerMillion: null,
  outputCostPerMillion: null,
  pricingStatus: "missing",
};

beforeEach(() => {
  catalogRows.length = 0;
  candidateRows.length = 0;
  catalogRows.push(resolvedModel);
  candidateRows.push(resolvedCandidate, missingCandidate);
  importModelsMock.mockReset();
  updateCatalogEntryMock.mockReset();
  useQueryMock.mockReset();
  importModelsMock.mockResolvedValue({ error: null, data: {} });
  updateCatalogEntryMock.mockResolvedValue({ error: null, data: {} });
  useQueryMock.mockImplementation(({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsBedrockModelImportCandidatesQuery) {
      return [
        {
          data: { bedrockModelImportCandidates: candidateRows },
          fetching: false,
        },
        vi.fn(),
      ];
    }
    return [
      { data: { tenantModelCatalog: catalogRows }, fetching: false },
      vi.fn(),
    ];
  });
});

afterEach(cleanup);

describe("SettingsModelCatalog", () => {
  it("renders a compact catalog table and opens details from the model row", () => {
    renderPage();

    const catalogTable = screen.getByRole("table");
    expect(catalogTable.className).toContain("w-full");
    expect(catalogTable.className).toContain("table-fixed");
    expect(catalogTable.className).not.toContain("w-max");

    expect(screen.getByText("Tenant Sonnet")).toBeTruthy();
    expect(screen.getByText("Bedrock")).toBeTruthy();
    expect(
      screen.getByText("us.anthropic.claude-sonnet-4-6").className,
    ).toContain("truncate");
    expect(screen.getByText("$3.00")).toBeTruthy();
    expect(screen.getByText("$15.00")).toBeTruthy();
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText("Capabilities")).toBeNull();

    fireEvent.click(screen.getByText("Tenant Sonnet"));

    expect(screen.getByText("Claude Sonnet 4.6")).toBeTruthy();
    expect(screen.getByText("enabled")).toBeTruthy();
    expect(screen.getByText("resolved")).toBeTruthy();
    expect(screen.getByText("Vision")).toBeTruthy();
    expect(screen.getByText("Tools")).toBeTruthy();
    expect(screen.getByText("200,000 ctx")).toBeTruthy();
  });

  it("keeps unresolved-price rows disabled in the details dialog", () => {
    catalogRows.splice(0, catalogRows.length, missingPriceModel);

    renderPage();

    fireEvent.click(screen.getByText("Tenant Titan"));

    const toggle = screen.getByRole("switch", {
      name: /pricing unresolved for tenant titan/i,
    }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText("missing")).toBeTruthy();
  });

  it("updates only the tenant display name", async () => {
    renderPage();

    fireEvent.click(screen.getByText("Tenant Sonnet"));
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Executive Sonnet" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateCatalogEntryMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          modelId: "us.anthropic.claude-sonnet-4-6",
          displayName: "Executive Sonnet",
        },
      });
    });
  });

  it("imports selected Bedrock candidates with display names and pricing-gated enablement", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /import/i }));
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /select claude sonnet 4.6/i,
      }),
    );
    fireEvent.change(
      screen.getByLabelText("Display name for Claude Sonnet 4.6"),
      {
        target: { value: "Executive Sonnet" },
      },
    );
    fireEvent.click(
      screen.getByRole("switch", {
        name: /enable claude sonnet 4.6 on import/i,
      }),
    );

    const unresolvedImportToggle = screen.getByRole("switch", {
      name: /enable titan text lite on import/i,
    }) as HTMLButtonElement;
    expect(unresolvedImportToggle.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /import selected/i }));

    await waitFor(() => {
      expect(importModelsMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          models: [
            {
              modelId: "us.anthropic.claude-sonnet-4-6",
              displayName: "Executive Sonnet",
              enabled: true,
            },
          ],
        },
      });
    });
  });
});
