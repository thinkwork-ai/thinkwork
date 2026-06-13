import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock Navigate so we can assert a redirect was rendered (and its target)
// without a router. The guard's only job is: render nothing until the role
// resolves, redirect resolved-non-operators, render children for operators.
vi.mock("@tanstack/react-router", () => ({
  Navigate: ({ to }: { to: string }) => (
    <div data-testid="navigate" data-to={to} />
  ),
}));

const tenantState = vi.hoisted(() => ({
  value: { isOperator: false, roleResolved: false },
}));
vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantState.value,
}));

import { OperatorGuard } from "./OperatorGuard";

afterEach(cleanup);

function renderGuard(state: { isOperator: boolean; roleResolved: boolean }) {
  tenantState.value = state;
  return render(
    <OperatorGuard>
      <div data-testid="child">operator content</div>
    </OperatorGuard>,
  );
}

describe("OperatorGuard", () => {
  it("renders nothing (no redirect) while the role is unresolved", () => {
    // This is the pre-hydration window — must NOT redirect operators away.
    const { container } = renderGuard({
      isOperator: false,
      roleResolved: false,
    });
    expect(screen.queryByTestId("navigate")).toBeNull();
    expect(screen.queryByTestId("child")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("redirects to /settings/general for a resolved non-operator (member)", () => {
    renderGuard({ isOperator: false, roleResolved: true });
    const nav = screen.getByTestId("navigate");
    expect(nav.getAttribute("data-to")).toBe("/settings/general");
    expect(screen.queryByTestId("child")).toBeNull();
  });

  it("renders children for a resolved operator", () => {
    renderGuard({ isOperator: true, roleResolved: true });
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(screen.queryByTestId("navigate")).toBeNull();
  });
});
