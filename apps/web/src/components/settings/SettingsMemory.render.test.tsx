import React from "react";
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
  ComputerMemoryEpisodicRecordsQuery,
  ComputerMemoryRecordsQuery,
  ComputerMemoryRetainAttemptsQuery,
  ComputerMemorySearchQuery,
} from "@/lib/graphql-queries";
import { SettingsTenantMembersQuery } from "@/lib/settings-queries";
import { SettingsMemory } from "./SettingsMemory";

vi.mock("urql", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1", userId: "user-1" }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("@/components/settings/SettingsContent", () => ({
  SettingsPageTitle: ({ title }: { title: React.ReactNode }) => (
    <h1>{title}</h1>
  ),
}));

vi.mock("@/components/LoadingShimmer", () => ({
  LoadingShimmer: () => <div>Loading…</div>,
}));

vi.mock("@thinkwork/ui", async () => {
  // The filter predicates and value guard must be real — client-side type
  // filtering is part of what these tests exercise.
  const actual =
    await vi.importActual<typeof import("@thinkwork/ui")>("@thinkwork/ui");
  return {
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  dataTableTokenFilterFns: actual.dataTableTokenFilterFns,
  isDataTableTokenFilterValue: actual.isDataTableTokenFilterValue,
  // One toggle button per option instead of the popover chrome (the real
  // component is exercised in the UI package); clicking mirrors the real
  // apply semantics onto the passed table.
  DataTableTokenFilter: ({ table, columns }: any) => (
    <div data-testid="memory-token-filter">
      {columns.flatMap((column: any) =>
        (column.options ?? []).map((option: any) => (
          <button
            key={`${column.id}-${option.value}`}
            type="button"
            data-testid={`token-filter-${column.id}-${option.value}`}
            onClick={() => {
              const current = table.getColumn(column.id)?.getFilterValue();
              const values =
                actual.isDataTableTokenFilterValue(current) &&
                Array.isArray(current.value)
                  ? (current.value as string[])
                  : [];
              const next = values.includes(option.value)
                ? values.filter((value) => value !== option.value)
                : column.singleSelect
                  ? [option.value]
                  : [...values, option.value];
              table.getColumn(column.id)?.setFilterValue(
                next.length
                  ? {
                      operator: column.singleSelect ? "is" : "is_any_of",
                      value: next,
                    }
                  : undefined,
              );
            }}
          >
            {option.label}
          </button>
        )),
      )}
    </div>
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
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Sheet: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetDescription: ({ children }: { children?: React.ReactNode }) => (
    <p>{children}</p>
  ),
  SheetHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetTitle: ({ children }: { children?: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  AlertDialog: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children?: React.ReactNode }) => (
    <button>{children}</button>
  ),
  AlertDialogContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children?: React.ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => (
    <h3>{children}</h3>
  ),
  AlertDialogTrigger: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  DataTable: ({
    columns,
    data,
    onRowClick,
  }: {
    columns: Array<any>;
    data: Array<any>;
    onRowClick?: (row: any) => void;
  }) => (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={String(column.accessorKey)}>{column.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr
            key={row.memoryRecordId}
            data-testid={`memory-row-${row.memoryRecordId}`}
            onClick={() => onRowClick?.(row)}
          >
            {columns.map((column) => (
              <td key={String(column.accessorKey)}>
                {column.cell
                  ? column.cell({ row: { original: row } })
                  : row[column.accessorKey]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
  };
});

const useQueryMock = vi.mocked(useQuery);
const useMutationMock = vi.mocked(useMutation);

const SEMANTIC_RECORD = {
  memoryRecordId: "rec-semantic",
  content: { text: "Eric prefers concise summaries" },
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:00:00.000Z",
  namespace: "assistant_user-1",
  strategy: "semantic",
  strategyId: "semantic",
  threadId: null,
};

const PREFERENCES_RECORD = {
  memoryRecordId: "rec-pref",
  content: { text: "Prefers dark mode" },
  createdAt: "2026-07-24T10:00:00.000Z",
  updatedAt: "2026-07-24T10:00:00.000Z",
  namespace: "preferences_user-1",
  strategy: "preferences",
  strategyId: "preferences",
  threadId: null,
};

const EPISODE_RECORD = {
  memoryRecordId: "rec-episode",
  content: { text: "Shipped the memory page" },
  createdAt: "2026-07-23T10:00:00.000Z",
  updatedAt: "2026-07-23T10:00:00.000Z",
  namespace: "episodes_user-1/session-9",
  strategy: "episodes",
  strategyId: "episodes",
  threadId: null,
};

let searchRecords: any[] = [];
let recordsRefetch = vi.fn();

function installQueryMock() {
  useQueryMock.mockImplementation(({ query }: any) => {
    if (query === ComputerMemoryRecordsQuery) {
      return [
        {
          data: { memoryRecords: [SEMANTIC_RECORD, PREFERENCES_RECORD] },
          fetching: false,
        },
        recordsRefetch,
      ] as any;
    }
    if (query === ComputerMemoryEpisodicRecordsQuery) {
      return [
        { data: { memoryEpisodicRecords: [EPISODE_RECORD] }, fetching: false },
        vi.fn(),
      ] as any;
    }
    if (query === ComputerMemorySearchQuery) {
      return [
        { data: { memorySearch: { records: searchRecords } }, fetching: false },
        vi.fn(),
      ] as any;
    }
    if (query === ComputerMemoryRetainAttemptsQuery) {
      return [
        { data: { memoryRetainAttempts: [] }, fetching: false },
        vi.fn(),
      ] as any;
    }
    if (query === SettingsTenantMembersQuery) {
      return [
        {
          data: {
            tenantMembers: [
              {
                principalType: "USER",
                principalId: "user-2",
                user: {
                  id: "user-2",
                  name: "Ada Lovelace",
                  email: "ada@example.com",
                  profile: { callBy: "Ada" },
                },
              },
            ],
          },
          fetching: false,
        },
        vi.fn(),
      ] as any;
    }
    // MemoryDetailSheet's source-thread lookup.
    return [{ data: undefined, fetching: false }, vi.fn()] as any;
  });
}

describe("SettingsMemory", () => {
  beforeEach(() => {
    searchRecords = [];
    recordsRefetch = vi.fn();
    installQueryMock();
    useMutationMock.mockReturnValue([{ fetching: false }, vi.fn()] as any);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows no engine banner — AgentCore is the only engine", () => {
    render(<SettingsMemory />);
    expect(screen.queryByTestId("memory-engine-banner")).toBeNull();
    expect(screen.queryByText(/Active engine/)).toBeNull();
  });

  it("merges the actor-scoped and episodic reads into one listing", () => {
    render(<SettingsMemory />);
    expect(screen.getByTestId("memory-row-rec-semantic")).toBeTruthy();
    expect(screen.getByTestId("memory-row-rec-pref")).toBeTruthy();
    expect(screen.getByTestId("memory-row-rec-episode")).toBeTruthy();
    // Episodes come from a second query because memoryRecords deliberately
    // skips the session-scoped namespaces.
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: ComputerMemoryEpisodicRecordsQuery,
        variables: expect.objectContaining({ tenantId: "tenant-1" }),
      }),
    );
  });

  it("filters the listing by memory type", () => {
    render(<SettingsMemory />);
    fireEvent.click(
      screen.getByTestId("token-filter-memoryType-preferences"),
    );
    expect(screen.getByTestId("memory-row-rec-pref")).toBeTruthy();
    expect(screen.queryByTestId("memory-row-rec-semantic")).toBeNull();
    expect(screen.queryByTestId("memory-row-rec-episode")).toBeNull();
  });

  it("restores the full listing when the type filter is toggled off", () => {
    render(<SettingsMemory />);
    fireEvent.click(screen.getByTestId("token-filter-memoryType-episodes"));
    expect(screen.getByTestId("memory-row-rec-episode")).toBeTruthy();
    expect(screen.queryByTestId("memory-row-rec-semantic")).toBeNull();
    fireEvent.click(screen.getByTestId("token-filter-memoryType-episodes"));
    expect(screen.getByTestId("memory-row-rec-semantic")).toBeTruthy();
    expect(screen.getByTestId("memory-row-rec-pref")).toBeTruthy();
    expect(screen.getByTestId("memory-row-rec-episode")).toBeTruthy();
  });

  it("runs the semantic search only on submit", () => {
    searchRecords = [
      {
        memoryRecordId: "rec-hit",
        content: { text: "Search hit" },
        createdAt: "2026-07-25T10:00:00.000Z",
        namespace: "assistant_user-1",
        strategy: "semantic",
        score: 0.87,
      },
    ];
    render(<SettingsMemory />);
    // The search starts collapsed to an icon button, like the Workflows
    // toolbar — expand it first.
    fireEvent.click(screen.getByRole("button", { name: "Search memory" }));
    const input = screen.getByPlaceholderText(
      "Search memory and press Enter...",
    );

    fireEvent.change(input, { target: { value: "summaries" } });
    // Typing alone must not fire the search — the query stays paused.
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: ComputerMemorySearchQuery,
        pause: true,
      }),
    );

    fireEvent.submit(input.closest("form")!);
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: ComputerMemorySearchQuery,
        pause: false,
        variables: expect.objectContaining({ query: "summaries" }),
      }),
    );
    expect(screen.getByTestId("memory-row-rec-hit")).toBeTruthy();
    expect(screen.getByText("Score")).toBeTruthy();
  });

  it("passes the selected facet to memorySearch as a strategy filter", () => {
    render(<SettingsMemory />);
    fireEvent.click(screen.getByTestId("token-filter-memoryType-preferences"));
    fireEvent.click(screen.getByRole("button", { name: "Search memory" }));
    const input = screen.getByPlaceholderText(
      "Search memory and press Enter...",
    );
    fireEvent.change(input, { target: { value: "dark" } });
    fireEvent.submit(input.closest("form")!);
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: ComputerMemorySearchQuery,
        variables: expect.objectContaining({ strategy: "PREFERENCES" }),
      }),
    );
  });

  it("deletes the selected record and refetches", async () => {
    const deleteMutation = vi.fn().mockResolvedValue({ error: undefined });
    useMutationMock.mockReturnValue([
      { fetching: false },
      deleteMutation,
    ] as any);

    render(<SettingsMemory />);
    fireEvent.click(screen.getByTestId("memory-row-rec-semantic"));
    // [0] is the sheet's trigger, [1] the confirm inside the alert dialog.
    fireEvent.click(screen.getAllByText("Forget", { selector: "button" })[1]);

    await waitFor(() =>
      expect(deleteMutation).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        userId: null,
        memoryRecordId: "rec-semantic",
      }),
    );
    await waitFor(() => expect(recordsRefetch).toHaveBeenCalled());
  });

  it("surfaces a delete failure instead of silently closing the sheet", async () => {
    const deleteMutation = vi
      .fn()
      .mockResolvedValue({ error: new Error("record is immutable") });
    useMutationMock.mockReturnValue([
      { fetching: false },
      deleteMutation,
    ] as any);

    render(<SettingsMemory />);
    fireEvent.click(screen.getByTestId("memory-row-rec-semantic"));
    fireEvent.click(screen.getAllByText("Forget", { selector: "button" })[1]);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "record is immutable",
      ),
    );
  });
});

describe("SettingsMemory contract", () => {
  it("offers no edit action — AgentCore records are immutable", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve(process.cwd(), "src/components/settings/SettingsMemory.tsx"),
      "utf8",
    );
    expect(source).not.toContain("updateMemoryRecord");
    // No legacy graph view, raw/curated toggle, or space pickers.
    expect(source).not.toContain("MemoryGraph");
    expect(source).not.toContain("isCuratedMemory");
    expect(source).not.toContain("SpacesQuery");
    expect(source).not.toContain('scope: "OPERATOR"');
  });
});
