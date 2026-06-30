import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PrototypePageId } from "./data/model";
import { ToolWorkspace } from "./components/ToolWorkspace";

afterEach(() => {
  cleanup();
});

describe("ToolWorkspace", () => {
  it("keeps tool navigation inside the app and handles missing opportunity context", () => {
    render(<Harness />);

    expect(
      screen.getByRole("heading", {
        name: "Value Discovery & Alignment Session",
      }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Discovery Tool" }));

    expect(screen.getByText("Select an opportunity")).toBeTruthy();
    expect(
      screen.getByText(
        "Open an opportunity before using the Discovery & KPI Tracker.",
      ),
    ).toBeTruthy();
  });
});

function Harness() {
  const [pageId, setPageId] = useState<PrototypePageId>("value-alignment");

  return (
    <ToolWorkspace
      activePageId={pageId}
      selectedAccount={null}
      selectedOpportunity={null}
      appOverlayBySection={new Map()}
      opportunityOverlayBySection={new Map()}
      appOverlayError={null}
      onBack={vi.fn()}
      onPageChange={setPageId}
      onSaveAppOverlay={vi.fn()}
      onSaveOpportunityOverlay={vi.fn()}
    />
  );
}
