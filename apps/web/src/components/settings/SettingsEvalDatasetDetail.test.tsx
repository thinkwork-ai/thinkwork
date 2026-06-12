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
  EvalDatasetCasesQuery,
  EvalDatasetQuery,
  RemoveEvalDatasetCaseMutation,
  StartEvalRunMutation,
  UpdateEvalDatasetCaseMutation,
} from "@/lib/evaluation-queries";
import {
  SettingsEvalDatasetDetail,
  flaggedCaseOutcomeKind,
  isFlaggedThreadCase,
} from "./SettingsEvalDatasetDetail";

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
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useNavigate: () => vi.fn(),
    useParams: () => ({ slug: "billing-regressions" }),
  };
});

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1", isOperator: true }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

const removeCaseMock = vi.fn();
const updateCaseMock = vi.fn();
const startRunMock = vi.fn();

const datasetData = {
  evalDataset: {
    id: "ds-2",
    slug: "billing-regressions",
    name: "Billing regressions",
    kind: "custom",
    version: 5,
    archivedAt: null,
    createdAt: "2026-06-02T00:00:00Z",
    updatedAt: "2026-06-11T00:00:00Z",
  },
};

const casesData = {
  evalTestCases: [
    {
      id: "c1",
      name: "Flagged: refund gone wrong",
      category: "flagged-thread",
      tags: ["flagged-thread", "quality"],
      enabled: true,
      source: "flagged",
      datasetId: "ds-2",
      datasetCaseId: "flagged-abc-def",
      createdAt: "2026-06-10T00:00:00Z",
      updatedAt: "2026-06-10T00:00:00Z",
    },
    {
      id: "c2",
      name: "Hand-authored billing case",
      category: "billing",
      tags: [],
      enabled: false,
      source: "manual",
      datasetId: "ds-2",
      datasetCaseId: "billing-1",
      createdAt: "2026-06-09T00:00:00Z",
      updatedAt: "2026-06-09T00:00:00Z",
    },
  ],
};

beforeEach(() => {
  removeCaseMock.mockReset();
  removeCaseMock.mockResolvedValue({ data: {}, error: undefined });
  updateCaseMock.mockReset();
  updateCaseMock.mockResolvedValue({ data: {}, error: undefined });
  startRunMock.mockReset();
  startRunMock.mockResolvedValue({ data: {}, error: undefined });

  vi.mocked(useQuery).mockImplementation((args) => {
    const { query } = args as { query: unknown };
    const data =
      query === EvalDatasetQuery
        ? datasetData
        : query === EvalDatasetCasesQuery
          ? casesData
          : undefined;
    return [
      { data, fetching: false, stale: false },
      vi.fn(),
    ] as unknown as ReturnType<typeof useQuery>;
  });
  vi.mocked(useMutation).mockImplementation((mutation) => {
    const fn =
      mutation === RemoveEvalDatasetCaseMutation
        ? removeCaseMock
        : mutation === UpdateEvalDatasetCaseMutation
          ? updateCaseMock
          : mutation === StartEvalRunMutation
            ? startRunMock
            : vi.fn().mockResolvedValue({ data: {}, error: undefined });
    return [{ fetching: false }, fn] as unknown as ReturnType<
      typeof useMutation
    >;
  });
});

afterEach(cleanup);

describe("flagged-thread provenance helpers (U11)", () => {
  it("identifies flagged-thread cases and their outcome kind", () => {
    expect(isFlaggedThreadCase({ category: "flagged-thread" })).toBe(true);
    expect(isFlaggedThreadCase({ category: "billing" })).toBe(false);
    expect(
      flaggedCaseOutcomeKind({ tags: ["flagged-thread", "security"] }),
    ).toBe("security");
    expect(
      flaggedCaseOutcomeKind({ tags: ["flagged-thread", "quality"] }),
    ).toBe("quality");
    expect(flaggedCaseOutcomeKind({ tags: [] })).toBeNull();
  });
});

describe("SettingsEvalDatasetDetail (U11)", () => {
  it("renders the case list with flagged-thread provenance", () => {
    render(<SettingsEvalDatasetDetail />);

    expect(screen.getByText("Flagged: refund gone wrong")).toBeTruthy();
    expect(screen.getByText("Hand-authored billing case")).toBeTruthy();
    expect(screen.getByText("flagged thread · quality")).toBeTruthy();
    expect(screen.getByText("authored")).toBeTruthy();
  });

  it("toggles a case's enabled state through updateEvalDatasetCase", async () => {
    render(<SettingsEvalDatasetDetail />);

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Toggle Hand-authored billing case",
      }),
    );

    await waitFor(() =>
      expect(updateCaseMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        datasetSlug: "billing-regressions",
        caseId: "billing-1",
        input: { enabled: true },
      }),
    );
  });

  it("removes a case only after a confirm that names the S3 payload deletion", async () => {
    render(<SettingsEvalDatasetDetail />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove case Flagged: refund gone wrong",
      }),
    );
    expect(removeCaseMock).not.toHaveBeenCalled();

    // The confirm copy must state that the S3 payload is deleted.
    expect((await screen.findByRole("alertdialog")).textContent).toContain(
      "S3 payload",
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove case" }));

    await waitFor(() =>
      expect(removeCaseMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        datasetSlug: "billing-regressions",
        caseId: "flagged-abc-def",
      }),
    );
  });
});
