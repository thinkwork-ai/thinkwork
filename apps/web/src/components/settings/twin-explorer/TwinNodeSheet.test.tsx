import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@thinkwork/ui", () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Sheet: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null,
  SheetContent: ({ children, ...props }: { children?: ReactNode }) => (
    <div {...props}>{children}</div>
  ),
}));

import { TwinNodeSheet, twinPropertyRows } from "./TwinNodeSheet";

const NODE = {
  id: "t#ten-1#e#cust-1",
  canonicalId: "cust-1",
  label: "ACME",
  typeLabel: "customer",
  isSystem: false,
  isCenter: true,
  properties: {
    displayName: "ACME",
    tenantId: "ten-1",
    "~hidden": "x",
    f_aging__daysPastDue: 94,
    f_aging__state: "synced",
    f_aging__batch: "2026-07-22-seed",
    f_aging__seq: 13,
    f_aging__synced_at: "2026-07-22T11:24:31Z",
  },
};

describe("twinPropertyRows", () => {
  it("groups facet stamps and hides internals, the tenant fence, and sync bookkeeping", () => {
    const rows = twinPropertyRows(NODE.properties);
    expect(rows).toEqual([
      { group: null, key: "displayName", value: "ACME" },
      { group: "aging", key: "daysPastDue", value: "94" },
      { group: "aging", key: "state", value: "synced" },
    ]);
  });
});

describe("TwinNodeSheet", () => {
  afterEach(cleanup);

  it("renders node properties grouped by facet with the entity jump", () => {
    const onOpenEntity = vi.fn();
    render(
      <TwinNodeSheet
        selection={{ kind: "node", node: NODE }}
        onOpenChange={vi.fn()}
        onOpenEntity={onOpenEntity}
      />,
    );
    expect(screen.getAllByText("ACME").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("aging")).toBeTruthy();
    expect(screen.getByText("daysPastDue")).toBeTruthy();
    expect(screen.getByText("94")).toBeTruthy();
    fireEvent.click(screen.getByTestId("twin-sheet-open-entity"));
    expect(onOpenEntity).toHaveBeenCalledWith({
      entityType: "customer",
      canonicalId: "cust-1",
    });
  });

  it("renders edge type, endpoint labels, and properties", () => {
    render(
      <TwinNodeSheet
        selection={{
          kind: "edge",
          link: {
            id: "e1",
            source: { id: "a", label: "ACME" } as never,
            target: { id: "b", label: "Tank 9" } as never,
            label: "customer_has_tank",
            properties: { since: "2024" },
          },
        }}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText("customer_has_tank")).toBeTruthy();
    expect(screen.getByText(/ACME/)).toBeTruthy();
    expect(screen.getByText(/Tank 9/)).toBeTruthy();
    expect(screen.getByText("since")).toBeTruthy();
    expect(screen.getByText("2024")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <TwinNodeSheet selection={null} onOpenChange={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
