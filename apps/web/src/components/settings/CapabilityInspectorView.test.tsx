/**
 * Inspector view tests (Agent page merge, THINK-132 U8).
 *
 * The read-only diagnostics surface that outlives the capability list: every
 * class renders, gate reasons show verbatim, runtime divergence badges show,
 * and the module imports no mutations by contract (R14).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CapabilityInspectorView,
  inspectorRowKey,
} from "./CapabilityInspectorView";

const ITEMS = [
  {
    capabilityClass: "skill",
    capabilityId: "approve-receipt",
    displayName: "Approve Receipt",
    active: true,
    provenance: "agent",
  },
  {
    capabilityClass: "skill",
    capabilityId: "expenses",
    displayName: "Expenses",
    active: false,
    provenance: "agent",
    reason: "oauth_not_connected",
    detail: "QuickBooks OAuth is not connected for this user",
  },
  {
    capabilityClass: "builtin_tool",
    capabilityId: "bash",
    displayName: "Bash",
    active: true,
  },
  {
    capabilityClass: "context",
    capabilityId: "memory-guide",
    displayName: "Memory Guide",
    active: true,
  },
];

const DELTAS = [
  {
    capabilityClass: "skill",
    capabilityId: "approve-receipt",
    kind: "missing_in_observed",
  },
];

afterEach(() => {
  cleanup();
});

describe("CapabilityInspectorView", () => {
  it("renders a tab for all seven capability classes with active/total counts", () => {
    render(
      <CapabilityInspectorView items={ITEMS} deltas={[]} loading={false} />,
    );
    for (const cls of [
      "skill",
      "builtin_tool",
      "mcp_server",
      "pi_extension",
      "plugin",
      "agent_profile",
      "context",
    ]) {
      expect(screen.getByTestId(`inspector-tab-${cls}`)).toBeTruthy();
    }
    expect(screen.getByTestId("inspector-tab-skill").textContent).toContain(
      "1/2",
    );
  });

  it("renders verbatim gate reason with detail for a gated row", () => {
    render(
      <CapabilityInspectorView items={ITEMS} deltas={[]} loading={false} />,
    );
    const reason = screen.getByTestId("inspector-reason-skill:expenses");
    expect(reason.textContent).toContain("oauth_not_connected");
    expect(reason.textContent).toContain(
      "QuickBooks OAuth is not connected for this user",
    );
  });

  it("shows the divergence badge for a missing_in_observed item", () => {
    render(
      <CapabilityInspectorView
        items={ITEMS}
        deltas={DELTAS}
        loading={false}
      />,
    );
    expect(
      screen.getByTestId("inspector-divergent-skill:approve-receipt")
        .textContent,
    ).toBe("Not loaded last turn");
  });

  it("switches class content via the tabs", () => {
    render(
      <CapabilityInspectorView items={ITEMS} deltas={[]} loading={false} />,
    );
    const tab = screen.getByTestId("inspector-tab-context");
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(
      screen.getByTestId("inspector-row-context:memory-guide"),
    ).toBeTruthy();
  });

  it("opens on the focused row's class and highlights the row", () => {
    render(
      <CapabilityInspectorView
        items={ITEMS}
        deltas={[]}
        loading={false}
        focusRowKey={inspectorRowKey({
          capabilityClass: "builtin_tool",
          capabilityId: "bash",
        })}
      />,
    );
    expect(
      screen.getByTestId("inspector-row-builtin_tool:bash").className,
    ).toContain("bg-accent");
  });

  it("renders the loading skeleton while fetching", () => {
    render(<CapabilityInspectorView items={[]} deltas={[]} loading />);
    expect(screen.getByTestId("inspector-view-loading")).toBeTruthy();
  });

  it("imports no mutations — read-only by contract (R14)", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/settings/CapabilityInspectorView.tsx"),
      "utf8",
    );
    expect(source).not.toContain("useMutation");
    expect(source).not.toContain("GrantCapability");
    expect(source).not.toContain("DetachCapability");
  });
});
