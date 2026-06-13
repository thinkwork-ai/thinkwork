import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, useQuery } from "urql";

import {
  ArchiveEvalDatasetMutation,
  EvalDatasetCaseIndexQuery,
  EvalDatasetsQuery,
} from "@/lib/evaluation-queries";
import {
  SettingsEvalDatasets,
  evalDatasetCaseCounts,
  evalDatasetKindBadgeVariant,
  isValidEvalDatasetSlug,
  suggestEvalDatasetSlug,
} from "./SettingsEvalDatasets";

vi.mock("urql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("urql")>();
  return {
    ...actual,
    useMutation: vi.fn(),
    useQuery: vi.fn(),
    useSubscription: vi.fn(),
  };
});

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    Link: ({
      children,
      to,
    }: {
      children: React.ReactNode;
      to: string;
      params?: Record<string, string>;
    }) => <a href={to}>{children}</a>,
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1", isOperator: true }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

const archiveDatasetMock = vi.fn();
const otherMutationMock = vi.fn();

const datasetsData = {
  evalDatasets: [
    {
      id: "ds-1",
      slug: "thinkwork-redteam-baseline",
      name: "Thinkwork RedTeam",
      kind: "baseline",
      version: 3,
      archivedAt: null,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-10T00:00:00Z",
    },
    {
      id: "ds-2",
      slug: "billing-regressions",
      name: "Billing regressions",
      kind: "custom",
      version: 5,
      archivedAt: null,
      createdAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-11T00:00:00Z",
    },
  ],
};

const caseIndexData = {
  evalTestCases: [
    { id: "c1", datasetId: "ds-1", enabled: true },
    { id: "c2", datasetId: "ds-1", enabled: true },
    { id: "c3", datasetId: "ds-1", enabled: false },
    { id: "c4", datasetId: "ds-2", enabled: true },
    // Pre-dataset legacy row — never counted.
    { id: "c5", datasetId: null, enabled: true },
  ],
};

beforeEach(() => {
  archiveDatasetMock.mockReset();
  archiveDatasetMock.mockResolvedValue({ data: {}, error: undefined });
  otherMutationMock.mockReset();
  otherMutationMock.mockResolvedValue({ data: {}, error: undefined });

  vi.mocked(useQuery).mockImplementation((args) => {
    const { query } = args as { query: unknown };
    const data =
      query === EvalDatasetsQuery
        ? datasetsData
        : query === EvalDatasetCaseIndexQuery
          ? caseIndexData
          : undefined;
    return [
      { data, fetching: false, stale: false },
      vi.fn(),
    ] as unknown as ReturnType<typeof useQuery>;
  });
  vi.mocked(useMutation).mockImplementation((mutation) => {
    const fn =
      mutation === ArchiveEvalDatasetMutation
        ? archiveDatasetMock
        : otherMutationMock;
    return [{ fetching: false }, fn] as unknown as ReturnType<
      typeof useMutation
    >;
  });
});

afterEach(cleanup);

describe("eval dataset helpers (U11)", () => {
  it("suggests valid slugs from human names", () => {
    expect(suggestEvalDatasetSlug("Billing Regressions!")).toBe(
      "billing-regressions",
    );
    expect(suggestEvalDatasetSlug("42 edge cases")).toBe("ds-42-edge-cases");
    expect(suggestEvalDatasetSlug("???")).toBe("");
    expect(isValidEvalDatasetSlug("billing-regressions")).toBe(true);
    expect(isValidEvalDatasetSlug("Billing")).toBe(false);
    expect(isValidEvalDatasetSlug("9lives")).toBe(false);
  });

  it("counts total and enabled cases per dataset from one index read", () => {
    const counts = evalDatasetCaseCounts(caseIndexData.evalTestCases);
    expect(counts.get("ds-1")).toEqual({ total: 3, enabled: 2 });
    expect(counts.get("ds-2")).toEqual({ total: 1, enabled: 1 });
    expect(counts.has("null")).toBe(false);
  });

  it("distinguishes baseline from custom kinds", () => {
    expect(evalDatasetKindBadgeVariant("baseline")).toBe("secondary");
    expect(evalDatasetKindBadgeVariant("custom")).toBe("outline");
  });
});

describe("SettingsEvalDatasets (U11)", () => {
  it("renders datasets with kind, version, and case counts", () => {
    render(<SettingsEvalDatasets />);

    expect(screen.getByText("Thinkwork RedTeam")).toBeTruthy();
    expect(screen.getByText("Billing regressions")).toBeTruthy();
    expect(screen.getByText("baseline")).toBeTruthy();
    expect(screen.getByText("custom")).toBeTruthy();
    expect(screen.getByText("v3")).toBeTruthy();
    expect(screen.getByText("v5")).toBeTruthy();
    // ds-1 has 2 enabled of 3 total index rows (one tombstoned/disabled).
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("of 3")).toBeTruthy();
  });

  it("archives only after the confirm dialog is accepted", async () => {
    render(<SettingsEvalDatasets />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Archive dataset billing-regressions",
      }),
    );
    // Mutation must not fire from opening the confirm.
    expect(archiveDatasetMock).not.toHaveBeenCalled();

    const confirm = await screen.findByRole("button", { name: "Archive" });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(archiveDatasetMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        slug: "billing-regressions",
      }),
    );
  });
});
