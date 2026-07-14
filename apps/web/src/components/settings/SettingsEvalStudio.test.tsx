import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { deleteCaseMock, refetchMock, toastMock, queryDocs, rows } = vi.hoisted(
  () => ({
    deleteCaseMock: vi.fn(),
    refetchMock: vi.fn(),
    toastMock: { success: vi.fn(), error: vi.fn() },
    queryDocs: {
      DeleteEvalTestCaseMutation: Symbol("deleteEvalTestCase"),
      EvalTestCasesQuery: Symbol("evalTestCases"),
      SeedEvalTestCasesMutation: Symbol("seedEvalTestCases"),
    },
    rows: [
      {
        id: "case-1",
        name: "Refuses prompt injection",
        category: "red-team",
        agentcoreEvaluatorIds: [],
        assertions: "[]",
        enabled: true,
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ],
  }),
);

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock("urql", () => ({
  useQuery: () => [
    { data: { evalTestCases: rows }, fetching: false },
    refetchMock,
  ],
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.DeleteEvalTestCaseMutation)
      return [{ fetching: false }, deleteCaseMock];
    return [{ fetching: false }, vi.fn()];
  },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: () => {},
}));
vi.mock("@/components/LoadingShimmer", () => ({
  LoadingShimmer: () => <div />,
}));
vi.mock("@/lib/evaluation-queries", () => queryDocs);
vi.mock("@/lib/utils", () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
  relativeTime: () => "just now",
}));

vi.mock("@thinkwork/ui", () => {
  const passthrough =
    (testId?: string) =>
    ({ children }: { children?: React.ReactNode }) => (
      <div data-testid={testId}>{children}</div>
    );
  return {
    AlertDialog: ({
      open,
      children,
    }: {
      open: boolean;
      children?: React.ReactNode;
    }) => (open ? <div role="alertdialog">{children}</div> : null),
    AlertDialogContent: passthrough(),
    AlertDialogHeader: passthrough(),
    AlertDialogFooter: passthrough(),
    AlertDialogTitle: passthrough("alert-title"),
    AlertDialogDescription: passthrough("alert-description"),
    AlertDialogAction: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    AlertDialogCancel: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    Badge: ({ children }: { children?: React.ReactNode }) => (
      <span>{children}</span>
    ),
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
      <input {...props} />
    ),
    TooltipIconButton: ({
      children,
      label,
    }: {
      children?: React.ReactNode;
      label: string;
    }) => <button aria-label={label}>{children}</button>,
    // Renders every column cell per row so the actions cell is clickable.
    DataTable: ({
      columns,
      data,
    }: {
      columns: Array<{
        cell?: (ctx: { row: { original: unknown } }) => React.ReactNode;
      }>;
      data: unknown[];
    }) => (
      <table>
        <tbody>
          {data.map((item, i) => (
            <tr key={i}>
              {columns.map((col, j) => (
                <td key={j}>
                  {typeof col.cell === "function"
                    ? col.cell({ row: { original: item } })
                    : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ),
  };
});

import { SettingsEvalStudio } from "./SettingsEvalStudio";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

async function openDeleteDialog() {
  render(<SettingsEvalStudio />);
  fireEvent.click(screen.getByRole("button", { name: "Delete test case" }));
  return screen.getByRole("alertdialog");
}

describe("SettingsEvalStudio delete flow (THINK-289)", () => {
  it("covers AE1: confirming deletes the row id, toasts success, and refetches network-only", async () => {
    deleteCaseMock.mockResolvedValue({ data: { deleteEvalTestCase: true } });

    const dialog = await openDeleteDialog();
    expect(dialog.textContent).toContain("Refuses prompt injection");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteCaseMock).toHaveBeenCalledWith({ id: "case-1" });
      expect(toastMock.success).toHaveBeenCalledWith("Test case deleted");
      expect(refetchMock).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
    });
    // Dialog closes once the flow resolves.
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("covers AE2: a failed delete toasts the error message and never refetches", async () => {
    deleteCaseMock.mockResolvedValue({
      error: { message: "Failed to delete test case" },
    });

    await openDeleteDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to delete test case"),
      );
    });
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(refetchMock).not.toHaveBeenCalled();
  });

  it("cancelling the dialog issues no mutation", async () => {
    await openDeleteDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteCaseMock).not.toHaveBeenCalled();
  });

  it("the delete flow never calls window.confirm", async () => {
    deleteCaseMock.mockResolvedValue({ data: { deleteEvalTestCase: true } });
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);

    await openDeleteDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteCaseMock).toHaveBeenCalled());

    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
