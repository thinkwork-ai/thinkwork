import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub the provenance popover — its radix internals aren't under test here.
vi.mock("./ProvenancePopover", () => ({
  ProvenancePopover: () => <span data-testid="provenance-stub" />,
}));

import { BoundWidgetChrome } from "./BoundWidgetChrome";
import type { CanvasBinding } from "./binding-display";

afterEach(cleanup);

function binding(overrides: Partial<CanvasBinding> = {}): CanvasBinding {
  return {
    id: "b1",
    partId: "part-1",
    elementId: "chart-1",
    mcpServerRef: "srv",
    serverName: "Costs API",
    toolName: "get_costs",
    redactedArgs: {},
    resultShapeHash: "hash",
    authContext: "TENANT_MCP",
    ownerUserId: null,
    quality: "GOOD",
    lastFetchedAt: null,
    lastGoodAt: null,
    ...overrides,
  };
}

describe("BoundWidgetChrome", () => {
  it("renders nothing when there are no bindings", () => {
    const { container } = render(
      <BoundWidgetChrome
        bindings={[]}
        currentUserId="u1"
        refreshingBindingIds={new Set()}
        onRefresh={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the binding quality badge and fires onRefresh for tenant bindings", () => {
    const onRefresh = vi.fn();
    render(
      <BoundWidgetChrome
        bindings={[binding({ quality: "STALE" })]}
        currentUserId="u1"
        refreshingBindingIds={new Set()}
        onRefresh={onRefresh}
      />,
    );
    expect(
      screen.getByTestId("freshness-badge").getAttribute("data-state"),
    ).toBe("STALE");
    const button = screen.getByTestId("binding-refresh-button");
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("overlays REFRESHING and disables the control while in flight", () => {
    render(
      <BoundWidgetChrome
        bindings={[binding()]}
        currentUserId="u1"
        refreshingBindingIds={new Set(["b1"])}
        onRefresh={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("freshness-badge").getAttribute("data-state"),
    ).toBe("REFRESHING");
    expect(
      screen.getByTestId("binding-refresh-button").hasAttribute("disabled"),
    ).toBe(true);
  });

  it("gives the owner a 'needs you' enabled control for per-user OAuth", () => {
    render(
      <BoundWidgetChrome
        bindings={[
          binding({ authContext: "PER_USER_OAUTH", ownerUserId: "u1" }),
        ]}
        currentUserId="u1"
        refreshingBindingIds={new Set()}
        onRefresh={vi.fn()}
      />,
    );
    const button = screen.getByTestId("binding-refresh-button");
    expect(button.textContent).toContain("Refresh needs you");
    expect(button.getAttribute("data-needs-owner")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("gives non-owners a disabled control naming the owner", () => {
    render(
      <BoundWidgetChrome
        bindings={[
          binding({
            authContext: "PER_USER_OAUTH",
            ownerUserId: "owner-xyz12345",
          }),
        ]}
        currentUserId="someone-else"
        refreshingBindingIds={new Set()}
        onRefresh={vi.fn()}
      />,
    );
    const button = screen.getByTestId("binding-refresh-button");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.textContent?.toLowerCase()).toContain("member owner-xy");
  });
});
