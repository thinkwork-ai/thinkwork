import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Route as MemoryLayoutRoute } from "../src/routes/_authed/_shell/memory";
import { Route as MemoryIndexRoute } from "../src/routes/_authed/_shell/memory.index";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Outlet: () => <div data-testid="outlet" />,
  };
});

const setActions = vi.fn();
const usePageHeaderActions = vi.fn();
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: (a: unknown) => usePageHeaderActions(a),
  usePageHeader: () => ({ actions: null, setActions }),
}));

describe("Memory layout (U4)", () => {
  beforeEach(() => {
    setActions.mockClear();
    usePageHeaderActions.mockClear();
  });
  afterEach(() => cleanup());

  it("renders an Outlet for child routes", () => {
    const Component = MemoryLayoutRoute.options.component!;
    const { getByTestId } = render(<Component />);
    expect(getByTestId("outlet")).toBeDefined();
  });

  it("pushes only { title: 'Memory' } to PageHeaderActions — tabs render in-page, not in AppTopBar", () => {
    const Component = MemoryLayoutRoute.options.component!;
    render(<Component />);
    expect(usePageHeaderActions).toHaveBeenCalledTimes(1);
    const arg = usePageHeaderActions.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toEqual({ title: "Memory" });
    // Hard guard against re-introducing a global-header tab push.
    expect(Object.prototype.hasOwnProperty.call(arg, "tabs")).toBe(false);
  });

  it("memory index route redirects (throws Redirect) so /memory lands on /memory/brain", () => {
    expect(() => {
      MemoryIndexRoute.options.beforeLoad?.({} as any);
    }).toThrow();
  });
});
