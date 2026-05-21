import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CustomizeTabBody } from "./CustomizeTabBody";
import type { CustomizeItem } from "./customize-filtering";

afterEach(cleanup);

const items: CustomizeItem[] = [
  {
    id: "slack",
    name: "Slack",
    description: "Send messages",
    category: "Messaging",
    connected: true,
    featured: true,
  },
  {
    id: "github",
    name: "GitHub",
    description: "Pull requests",
    category: "Engineering",
    connected: false,
    featured: true,
    typeBadge: "MCP",
  },
  {
    id: "drive",
    name: "Google Drive",
    description: "Files",
    category: "Files",
    connected: false,
    featured: false,
  },
];

function bodyRows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll('[data-testid="customize-table"] tbody tr'),
  ) as HTMLElement[];
}

function rowFor(name: string): HTMLElement {
  const found = bodyRows().find((row) => row.textContent?.includes(name));
  if (!found) throw new Error(`Row containing "${name}" not found`);
  return found;
}

describe("CustomizeTabBody", () => {
  it("renders the empty message when no items match filters", () => {
    render(
      <CustomizeTabBody
        activeTab="/customize/skills"
        items={[]}
        emptyMessage="Nothing yet"
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("customize-table-empty").textContent).toMatch(
      /Nothing yet/,
    );
  });

  it("renders one row per item", () => {
    render(
      <CustomizeTabBody
        activeTab="/customize/skills"
        items={items}
        onAction={vi.fn()}
      />,
    );
    expect(bodyRows()).toHaveLength(3);
  });

  it("filters by search text", () => {
    render(
      <CustomizeTabBody
        activeTab="/customize/skills"
        items={items}
        onAction={vi.fn()}
      />,
    );
    const search = screen.getByTestId(
      "customize-search",
    ) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "drive" } });
    const rows = bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toMatch(/Google Drive/);
  });

  it("renders the toolbar with search left, tabs centered, category right", () => {
    render(
      <CustomizeTabBody
        activeTab="/customize/skills"
        items={items}
        onAction={vi.fn()}
      />,
    );
    const toolbar = screen.getByTestId("customize-toolbar");
    expect(toolbar.querySelector('[data-testid="customize-search"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-testid="customize-tabs"]')).not.toBeNull();
    expect(
      toolbar.querySelector('[data-testid="customize-category"]'),
    ).not.toBeNull();
  });

  it("renders Connected and Available status cells", () => {
    render(
      <CustomizeTabBody
        activeTab="/customize/skills"
        items={items}
        onAction={vi.fn()}
      />,
    );
    expect(rowFor("Slack").textContent).toMatch(/Connected/);
    expect(rowFor("GitHub").textContent).toMatch(/Available/);
  });

  it("opens the detail sheet when a row is clicked", () => {
    render(
      <CustomizeTabBody
        activeTab="/customize/skills"
        items={items}
        onAction={vi.fn()}
      />,
    );
    fireEvent.click(rowFor("GitHub"));
    // SheetTitle renders the item name
    expect(screen.queryAllByText("GitHub").length).toBeGreaterThan(0);
    const sheetAction = screen.getByTestId("customize-detail-action");
    expect(sheetAction.textContent).toMatch(/Connect/);
  });

  it("forwards detail-sheet actions to the parent handler", () => {
    const onAction = vi.fn();
    render(
      <CustomizeTabBody
        activeTab="/customize/skills"
        items={items}
        onAction={onAction}
      />,
    );
    fireEvent.click(rowFor("GitHub"));
    fireEvent.click(screen.getByTestId("customize-detail-action"));
    expect(onAction).toHaveBeenCalledWith("github", true);
  });
});
