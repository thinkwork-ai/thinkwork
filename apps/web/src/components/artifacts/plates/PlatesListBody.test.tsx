import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Selecting a row mounts PlatePreviewPanel, whose useQuery needs a urql
// client. The static `items` seam path never issues a real request, so stub
// useQuery to a paused-empty result rather than standing up a Provider.
vi.mock("urql", async () => ({
  ...(await vi.importActual<typeof import("urql")>("urql")),
  useQuery: () => [{ data: undefined, fetching: false, error: undefined }],
}));

import { ThemeProvider } from "@thinkwork/ui";
import { PlatesListBody } from "./PlatesListBody";
import type { PlateItem } from "./plate-support";

function renderList(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function plate(overrides: Partial<PlateItem> = {}): PlateItem {
  return {
    slug: "report",
    displayName: "Report",
    useFor: "Board reports",
    eyebrow: "Report",
    titleSuffix: "",
    tokensLight: {},
    tokensDark: {},
    allowedDirectives: null,
    origin: "platform",
    hidden: false,
    customized: false,
    overrides: null,
    ...overrides,
  };
}

const items: PlateItem[] = [
  plate({ slug: "report", displayName: "Report", origin: "platform" }),
  plate({
    slug: "brief",
    displayName: "Executive Brief",
    origin: "tenant",
    useFor: "Quick updates",
    allowedDirectives: ["stats"],
  }),
  plate({
    slug: "legacy",
    displayName: "Legacy",
    origin: "tenant",
    hidden: true,
  }),
];

function rows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="plates-table-row"]'),
  );
}

afterEach(cleanup);

describe("PlatesListBody", () => {
  it("renders one row per plate with origin badges", () => {
    renderList(<PlatesListBody items={items} isOperator roleResolved />);
    expect(rows()).toHaveLength(3);
    const table = screen.getByTestId("plates-table");
    expect(table.textContent).toMatch(/Platform/);
    expect(table.textContent).toMatch(/Custom/);
  });

  it("marks hidden plates for operators", () => {
    renderList(<PlatesListBody items={items} isOperator roleResolved />);
    expect(screen.getByTestId("plates-hidden-badge")).not.toBeNull();
  });

  it("filters to hidden plates via the state token filter (operator)", () => {
    renderList(<PlatesListBody items={items} isOperator roleResolved />);
    // Operators get the state filter column; hidden rows are present to filter.
    expect(rows().some((r) => r.textContent?.includes("Legacy"))).toBe(true);
  });

  it("shows the customized indicator for overridden platform plates", () => {
    renderList(
      <PlatesListBody
        items={[plate({ origin: "platform", customized: true })]}
        isOperator
        roleResolved
      />,
    );
    expect(screen.getByTestId("plates-customized-badge")).not.toBeNull();
  });

  it("shows operator affordances for operators", () => {
    renderList(<PlatesListBody items={items} isOperator roleResolved />);
    expect(screen.getByTestId("plates-new")).not.toBeNull();
    expect(screen.getByTestId("plates-tenant-palette")).not.toBeNull();
    expect(screen.getAllByTestId("plate-edit-action").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByTestId("plate-clone-action").length).toBeGreaterThan(
      0,
    );
  });

  it("hides all operator affordances for non-operators (AE5)", () => {
    renderList(
      <PlatesListBody items={items} isOperator={false} roleResolved />,
    );
    expect(screen.queryByTestId("plates-new")).toBeNull();
    expect(screen.queryByTestId("plates-tenant-palette")).toBeNull();
    expect(screen.queryByTestId("plate-edit-action")).toBeNull();
    expect(screen.queryByTestId("plate-clone-action")).toBeNull();
  });

  it("selects a plate on row click", () => {
    renderList(<PlatesListBody items={items} isOperator roleResolved />);
    const row = rows()
      .find((r) => r.textContent?.includes("Executive Brief"))
      ?.closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(row as HTMLElement);
    // The table records the selection via a data attribute.
    expect(
      screen.getByTestId("plates-table").getAttribute("data-selected-slug"),
    ).toBe("brief");
  });

  it("filters rows by the search box", () => {
    renderList(<PlatesListBody items={items} isOperator roleResolved />);
    const search = screen.getByTestId("plates-search") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "brief" } });
    const remaining = rows();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.textContent).toMatch(/Executive Brief/);
  });
});
