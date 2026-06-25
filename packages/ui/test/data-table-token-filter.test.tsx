// @vitest-environment jsdom

import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DataTableTokenFilter,
  dataTableTokenFilterFns,
  matchesDataTableTokenFilter,
  type DataTableTokenFilterColumn,
} from "../src/index.js";

interface Row {
  searchText: string;
  status: string;
  blocked: boolean | null;
}

const filterColumns: DataTableTokenFilterColumn[] = [
  { id: "searchText", label: "Search", type: "text" },
  {
    id: "status",
    label: "Status",
    type: "option",
    options: [
      { value: "TODO", label: "Todo" },
      { value: "DONE", label: "Done" },
    ],
  },
  {
    id: "blocked",
    label: "Blocked",
    type: "boolean",
  },
];

const rows: Row[] = [
  { searchText: "Customer onboarding", status: "DONE", blocked: true },
  { searchText: "Platform cleanup", status: "TODO", blocked: false },
];

const tableColumns: ColumnDef<Row>[] = [
  {
    accessorKey: "searchText",
    filterFn: dataTableTokenFilterFns.text,
  },
  {
    accessorKey: "status",
    filterFn: dataTableTokenFilterFns.option,
  },
  {
    accessorKey: "blocked",
    filterFn: dataTableTokenFilterFns.boolean,
  },
];

afterEach(() => cleanup());

describe("matchesDataTableTokenFilter", () => {
  it("matches text filters case-insensitively and treats empty text as inactive", () => {
    expect(
      matchesDataTableTokenFilter("Customer onboarding", {
        operator: "contains",
        value: "ONBOARDING",
      }),
    ).toBe(true);
    expect(
      matchesDataTableTokenFilter("Customer onboarding", {
        operator: "does_not_contain",
        value: "billing",
      }),
    ).toBe(true);
    expect(
      matchesDataTableTokenFilter("Customer onboarding", {
        operator: "contains",
        value: "",
      }),
    ).toBe(true);
  });

  it("matches option and boolean filters with is/is not operators", () => {
    expect(
      matchesDataTableTokenFilter("DONE", { operator: "is", value: "DONE" }),
    ).toBe(true);
    expect(
      matchesDataTableTokenFilter("TODO", {
        operator: "is_not",
        value: "DONE",
      }),
    ).toBe(true);
    expect(
      matchesDataTableTokenFilter(false, { operator: "is", value: false }),
    ).toBe(true);
    expect(
      matchesDataTableTokenFilter(null, { operator: "is_not", value: true }),
    ).toBe(true);
  });

  it("matches option filters against any selected value", () => {
    expect(
      matchesDataTableTokenFilter("DONE", {
        operator: "is_any_of",
        value: ["TODO", "DONE"],
      }),
    ).toBe(true);
    expect(
      matchesDataTableTokenFilter("ACTIVE", {
        operator: "is_any_of",
        value: ["TODO", "DONE"],
      }),
    ).toBe(false);
    expect(
      matchesDataTableTokenFilter("ACTIVE", {
        operator: "is_none_of",
        value: ["TODO", "DONE"],
      }),
    ).toBe(true);
  });
});

describe("DataTableTokenFilter", () => {
  it("adds option tokens, renders segmented token controls, and resets pagination", () => {
    render(<TokenFilterHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Done" }));

    expect(screen.getByTestId("filters").textContent).toContain(
      '"operator":"is_any_of"',
    );
    expect(screen.getByTestId("filters").textContent).toContain(
      '"value":["DONE"]',
    );
    expect(screen.getByTestId("page-index").textContent).toBe("0");
    expect(screen.getByTestId("row-count").textContent).toBe("1");

    const token = screen.getByLabelText("Status filter");
    expect(token.textContent).toContain("Status");
    expect(token.textContent).toContain("is any of");
    expect(token.textContent).toContain("Done");
  });

  it("supports selecting multiple option values", () => {
    render(<TokenFilterHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Done" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Todo" }));

    expect(screen.getByTestId("filters").textContent).toContain(
      '"value":["DONE","TODO"]',
    );
    expect(screen.getByTestId("row-count").textContent).toBe("2");

    const token = screen.getByLabelText("Status filter");
    expect(token.textContent).toContain("2 statuses");
  });

  it("keeps one token when adding another value to the same field", () => {
    render(
      <TokenFilterHarness
        initialFilters={[
          {
            id: "status",
            value: { operator: "is_any_of", value: ["DONE"] },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Status values" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Todo" }));

    const filters = JSON.parse(screen.getByTestId("filters").textContent ?? "");
    expect(filters).toEqual([
      {
        id: "status",
        value: { operator: "is_any_of", value: ["DONE", "TODO"] },
      },
    ]);
  });

  it("removes one token and clears all tokens", () => {
    render(
      <TokenFilterHarness
        initialFilters={[
          { id: "status", value: { operator: "is_any_of", value: ["DONE"] } },
          { id: "blocked", value: { operator: "is", value: true } },
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Status filter" }),
    );
    expect(screen.getByTestId("filters").textContent).not.toContain("status");
    expect(screen.getByTestId("filters").textContent).toContain("blocked");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByTestId("filters").textContent).toBe("[]");
  });

  it("commits text filters on Enter and cancels empty drafts on Escape", () => {
    render(<TokenFilterHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.keyDown(screen.getByLabelText("Search value"), { key: "Escape" });
    expect(screen.getByTestId("filters").textContent).toBe("[]");

    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByLabelText("Search value"), {
      target: { value: "onboarding" },
    });
    fireEvent.keyDown(screen.getByLabelText("Search value"), { key: "Enter" });

    expect(screen.getByTestId("filters").textContent).toContain(
      '"value":"onboarding"',
    );
  });

  it("renders option loading, empty, unavailable, and failed states from config", () => {
    const columns: DataTableTokenFilterColumn[] = [
      {
        id: "loading",
        label: "Loading",
        type: "option",
        options: [],
        loading: true,
        loadingMessage: "Loading choices...",
      },
      {
        id: "empty",
        label: "Empty",
        type: "option",
        options: [],
        emptyMessage: "No Spaces available.",
      },
      {
        id: "failed",
        label: "Failed",
        type: "option",
        options: [],
        errorMessage: "Spaces query failed.",
      },
      {
        id: "disabled",
        label: "Disabled",
        type: "option",
        options: [],
        disabledReason: "Already scoped by route.",
      },
    ];

    render(<TokenFilterHarness filterColumns={columns} />);

    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Loading" }));
    expect(screen.getByText("Loading choices...")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Back to filter subjects" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Empty" }));
    expect(screen.getByText("No Spaces available.")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Back to filter subjects" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    expect(screen.getByText("Spaces query failed.")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Back to filter subjects" }),
    );

    expect(
      screen.getByRole("button", { name: "Disabled Already scoped by route." }),
    ).toHaveProperty("disabled", true);
  });
});

function TokenFilterHarness({
  initialFilters = [],
  filterColumns: columns = filterColumns,
}: {
  initialFilters?: ColumnFiltersState;
  filterColumns?: DataTableTokenFilterColumn[];
}) {
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>(initialFilters);
  const [pagination, setPagination] = React.useState({
    pageIndex: 2,
    pageSize: 1,
  });
  const setPageIndex = vi.fn((updater: number | ((old: number) => number)) => {
    setPagination((current) => ({
      ...current,
      pageIndex:
        typeof updater === "function" ? updater(current.pageIndex) : updater,
    }));
  });

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    state: { columnFilters, pagination },
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });

  table.setPageIndex = setPageIndex as typeof table.setPageIndex;

  return (
    <div>
      <DataTableTokenFilter table={table} columns={columns} />
      <output data-testid="filters">{JSON.stringify(columnFilters)}</output>
      <output data-testid="page-index">{pagination.pageIndex}</output>
      <output data-testid="row-count">
        {table.getFilteredRowModel().rows.length}
      </output>
    </div>
  );
}
