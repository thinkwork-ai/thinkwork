import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Route as MemoryLayoutRoute } from "../src/routes/_authed/_shell/memory";
import { Route as MemoryIndexRoute } from "../src/routes/_authed/_shell/memory.index";

const pathnameRef = { current: "/memory/brain" };

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
      <a href={to}>{children}</a>
    ),
    Outlet: () => <div data-testid="outlet" />,
    useRouterState: ({ select }: { select: (s: any) => unknown }) =>
      select({ location: { pathname: pathnameRef.current } }),
  };
});

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

describe("Memory layout (U4)", () => {
  beforeEach(() => {
    pathnameRef.current = "/memory/brain";
  });
  afterEach(() => cleanup());

  it("renders Brain, Pages, KBs tabs as links to the right routes", () => {
    const Component = MemoryLayoutRoute.options.component!;
    const { container } = render(<Component />);
    const links = Array.from(container.querySelectorAll("a")).map((a) => ({
      label: a.textContent,
      href: a.getAttribute("href"),
    }));
    expect(links).toEqual(
      expect.arrayContaining([
        { label: "Brain", href: "/memory/brain" },
        { label: "Pages", href: "/memory/pages" },
        { label: "KBs", href: "/memory/kbs" },
      ]),
    );
  });

  it("renders an Outlet for child routes", () => {
    const Component = MemoryLayoutRoute.options.component!;
    const { getByTestId } = render(<Component />);
    expect(getByTestId("outlet")).toBeDefined();
  });

  it("memory index route redirects (throws Redirect) so /memory lands on /memory/brain", () => {
    expect(() => {
      MemoryIndexRoute.options.beforeLoad?.({} as any);
    }).toThrow();
  });
});
