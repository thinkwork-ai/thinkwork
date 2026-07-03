import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DataTableView } from "./DataTableView";

afterEach(() => {
  cleanup();
});

const columns = [
  { id: "name", header: "Name" },
  { id: "score", header: "Score", sortable: true },
];

const rows = [
  { id: "a", name: "Alpha", score: 3 },
  { id: "b", name: "Beta", score: 1 },
  { id: "c", name: "Gamma", score: 2 },
];

function firstColumnOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("tbody tr")).map(
    (row) => row.querySelector("td")?.textContent ?? "",
  );
}

describe("DataTableView", () => {
  it("renders columns and rows", () => {
    render(<DataTableView title="Scores" columns={columns} rows={rows} />);

    expect(screen.getByTestId("json-render-table")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Gamma")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Name/ })).toBeTruthy();
  });

  it("reorders rows when a sortable header is clicked", () => {
    const { container } = render(
      <DataTableView columns={columns} rows={rows} />,
    );

    expect(firstColumnOrder(container)).toEqual(["Alpha", "Beta", "Gamma"]);

    fireEvent.click(screen.getByRole("button", { name: /Score/ }));

    // Ascending by score: Beta(1), Gamma(2), Alpha(3).
    expect(firstColumnOrder(container)).toEqual(["Beta", "Gamma", "Alpha"]);
  });

  it("applies an initial sort from the sort prop", () => {
    const { container } = render(
      <DataTableView
        columns={columns}
        rows={rows}
        sort={{ columnId: "score", direction: "desc" }}
      />,
    );

    expect(firstColumnOrder(container)).toEqual(["Alpha", "Gamma", "Beta"]);
  });

  it("tolerates partial frames without throwing", () => {
    expect(() =>
      render(<DataTableView columns={columns} rows={undefined} />),
    ).not.toThrow();
    expect(screen.getByTestId("json-render-table")).toBeTruthy();

    cleanup();

    expect(() =>
      render(<DataTableView columns={undefined} rows={undefined} />),
    ).not.toThrow();
    expect(screen.getByTestId("json-render-table")).toBeTruthy();
  });
});
