import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// react-resizable-panels chokes on apps/web's ResizeObserver stub — render
// plain passthroughs so the table/preview split mounts deterministically
// (same workaround as TaskThreadView.test.tsx).
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ...actual,
    ResizablePanelGroup: pass,
    ResizablePanel: pass,
    ResizableHandle: () => <div data-testid="resizable-handle" />,
  };
});

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

  it("shows operator affordances and publishes the header actions controller for operators", () => {
    const controllers: unknown[] = [];
    renderList(
      <PlatesListBody
        items={items}
        isOperator
        roleResolved
        onActionsControllerChange={(c) => controllers.push(c)}
      />,
    );
    // Edit/Clone live in the preview panel header: select a row first.
    fireEvent.click(screen.getAllByTestId("plates-table-row")[0]);
    expect(screen.getByTestId("plate-edit-action")).not.toBeNull();
    expect(screen.getByTestId("plate-clone-action")).not.toBeNull();
    // Create/palette live in the page header now: the body hands the header a
    // controller instead of rendering its own toolbar buttons.
    const controller = controllers.at(-1) as {
      openCreate: () => void;
      openPalette: () => void;
    } | null;
    expect(controller).not.toBeNull();
    expect(typeof controller!.openCreate).toBe("function");
    expect(typeof controller!.openPalette).toBe("function");
  });

  it("hides all operator affordances for non-operators (AE5)", () => {
    const controllers: unknown[] = [];
    renderList(
      <PlatesListBody
        items={items}
        isOperator={false}
        roleResolved
        onActionsControllerChange={(c) => controllers.push(c)}
      />,
    );
    expect(screen.queryByTestId("plate-edit-action")).toBeNull();
    expect(screen.queryByTestId("plate-clone-action")).toBeNull();
    // Non-operators never receive the header controller.
    expect(controllers.at(-1) ?? null).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Search plates" }));
    const search = screen.getByRole("textbox", {
      name: "Search plates",
    }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "brief" } });
    const remaining = rows();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.textContent).toMatch(/Executive Brief/);
  });
});
