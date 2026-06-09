import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
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

    const columnWidths = Array.from(
      catalogTable.querySelectorAll("col"),
      (col) => col.getAttribute("style") ?? "",
    );
    expect(columnWidths).toEqual([
      "width: 144px;",
      "width: 120px;",
      "",
      "width: 86px;",
      "width: 92px;",
    ]);

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

  it("saves manual input and output token prices", async () => {
    catalogRows.splice(0, catalogRows.length, missingPriceModel);

    renderPage();

    fireEvent.click(screen.getByText("Tenant Titan"));
    fireEvent.change(screen.getByLabelText("Input price"), {
      target: { value: "0.55" },
    });
    fireEvent.change(screen.getByLabelText("Output price"), {
      target: { value: "2.19" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateCatalogEntryMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          modelId: "amazon.titan-text-lite-v1",
          displayName: "Tenant Titan",
          inputCostPerMillion: 0.55,
          outputCostPerMillion: 2.19,
        },
      });
    });
  });

  it("shows an inline error when the deployed API does not support manual pricing yet", async () => {
    catalogRows.splice(0, catalogRows.length, missingPriceModel);
    updateCatalogEntryMock.mockResolvedValueOnce({
      error: {
        graphQLErrors: [
          {
            message:
              'Field "inputCostPerMillion" is not defined by type "UpdateTenantModelCatalogEntryInput".',
          },
        ],
        message: "GraphQL validation failed",
      },
    });

    renderPage();

    fireEvent.click(screen.getByText("Tenant Titan"));
    fireEvent.change(screen.getByLabelText("Input price"), {
      target: { value: "0.55" },
    });
    fireEvent.change(screen.getByLabelText("Output price"), {
      target: { value: "2.19" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        /manual pricing requires the latest api deployment/i,
      ),
    ).toBeTruthy();
  });

  it("imports selected Bedrock candidates with display names", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /import/i }));
    const importDialog = await screen.findByRole("dialog", {
      name: /import bedrock models/i,
    });
    expect(importDialog.className).toContain("h-[min(88vh,760px)]");
    expect(importDialog.className).toContain("w-[min(94vw,1180px)]");
    expect(importDialog.className).toContain("max-w-none");
    expect(screen.queryByText("Capabilities")).toBeNull();
    expect(within(importDialog).queryByText("Provider")).toBeNull();
    expect(within(importDialog).queryByText("Pricing")).toBeNull();
    expect(within(importDialog).queryByText("Enable")).toBeNull();
    expect(within(importDialog).queryByText("N/A")).toBeNull();

    const importTable = within(importDialog).getByRole("table");
    expect(importTable.className).not.toContain("table-fixed");
    expect(importTable.querySelectorAll("col")).toHaveLength(0);
    expect(
      within(importDialog).getByText("Name").closest("th")?.className,
    ).toContain("px-4");
    expect(
      within(importDialog).getByText("us.anthropic.claude-sonnet-4-6")
        .className,
    ).toContain("truncate");
    expect(
      within(importDialog)
        .getByRole("checkbox", { name: /select claude sonnet 4.6/i })
        .closest("div")?.className,
    ).toContain("items-start");
    expect(
      within(importDialog).getByText("Claude Sonnet 4.6").closest("div")
        ?.parentElement?.className,
    ).toContain("min-h-16");
    expect(
      within(importDialog).getByText("Claude Sonnet 4.6").closest("div")
        ?.parentElement?.className,
    ).toContain("pb-3");
    expect(
      within(importDialog).getByText("Claude Sonnet 4.6").closest("div")
        ?.parentElement?.className,
    ).toContain("pt-2");
    expect(within(importDialog).queryByText(/rows per page/i)).toBeNull();
    expect(within(importDialog).queryByText(/page 1 of/i)).toBeNull();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /select claude sonnet 4.6/i,
      }),
    );
    fireEvent.change(
      screen.getByLabelText("Display name for Claude Sonnet 4.6"),
      {
        target: { value: "Executive Sonnet" },
      },
    );
    expect(
      screen.queryByRole("switch", {
        name: /enable claude sonnet 4.6 on import/i,
      }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /import selected/i }));

    await waitFor(() => {
      expect(importModelsMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          models: [
            {
              modelId: "us.anthropic.claude-sonnet-4-6",
              displayName: "Executive Sonnet",
              enabled: false,
            },
          ],
        },
      });
    });
  });
});
