import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { pathnameMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: pathnameMock() } }),
}));

import { AppModeTabs } from "./AppModeTabs";

afterEach(() => {
  cleanup();
  pathnameMock.mockReset();
});

describe("AppModeTabs", () => {
  it("marks Chat active for thread routes", () => {
    pathnameMock.mockReturnValue("/threads/thread-1");
    render(<AppModeTabs />);

    expect(
      screen.getByRole("link", { name: /chat/i }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: /spaces/i })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("marks Spaces active for Spaces routes", () => {
    pathnameMock.mockReturnValue("/spaces/space-1");
    render(<AppModeTabs />);

    expect(
      screen
        .getByRole("link", { name: /spaces/i })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("keeps Chat active for Space-owned thread routes", () => {
    pathnameMock.mockReturnValue("/spaces/space-1/threads/thread-1");
    render(<AppModeTabs />);

    expect(
      screen.getByRole("link", { name: /chat/i }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: /spaces/i })
        .getAttribute("aria-current"),
    ).toBeNull();
  });
});
