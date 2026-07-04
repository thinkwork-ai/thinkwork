import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// Render the popover content inline so its (already-redacted) provenance body is
// asserted without driving radix pointer internals in jsdom.
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    PopoverContent: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

import { ProvenancePopover } from "./ProvenancePopover";
import type { CanvasBinding } from "./binding-display";

afterEach(cleanup);

const binding: CanvasBinding = {
  id: "b1",
  partId: "part-1",
  elementId: "chart-1",
  mcpServerRef: "srv",
  serverName: "Costs API",
  toolName: "get_costs",
  redactedArgs: { region: "us-east-1", token: "«redacted»" },
  resultShapeHash: "hash",
  authContext: "PER_USER_OAUTH",
  ownerUserId: "u1",
  quality: "GOOD",
  lastFetchedAt: null,
  lastGoodAt: null,
};

describe("ProvenancePopover", () => {
  it("shows the server, tool, auth context, and redacted args", () => {
    render(<ProvenancePopover binding={binding} />);
    expect(screen.getByText("Costs API")).toBeTruthy();
    expect(screen.getByText("get_costs")).toBeTruthy();
    expect(screen.getByTestId("provenance-auth").textContent).toContain(
      "Per-user",
    );
    expect(screen.getByTestId("provenance-last-fetched").textContent).toContain(
      "Never",
    );
    const args = screen.getByTestId("provenance-args");
    expect(args.textContent).toContain("region");
    expect(args.textContent).toContain("us-east-1");
    // The value was already redacted server-side; we render it verbatim.
    expect(args.textContent).toContain("«redacted»");
  });
});
