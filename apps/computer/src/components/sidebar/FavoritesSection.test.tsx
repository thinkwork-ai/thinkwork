import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SidebarProvider, TooltipProvider } from "@thinkwork/ui";

// jsdom doesn't ship matchMedia; @thinkwork/ui's `use-mobile` hook
// (which Sidebar uses) calls it on mount and crashes without a stub.
beforeAll(() => {
  if (typeof window !== "undefined" && !window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useRouterState: () => "/",
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

vi.mock("urql", () => ({
  useQuery: () => [{ data: { artifacts: [] }, fetching: false, error: null }],
}));

vi.mock("@/lib/graphql-queries", () => ({
  FavoriteArtifactsQuery: Symbol("FavoriteArtifactsQuery"),
}));

import { FavoritesSection } from "./FavoritesSection";

function renderInSidebar(node: React.ReactNode) {
  return render(
    <TooltipProvider>
      <SidebarProvider>{node}</SidebarProvider>
    </TooltipProvider>,
  );
}

afterEach(cleanup);

describe("FavoritesSection", () => {
  it("renders nothing when there are zero favorites", () => {
    renderInSidebar(<FavoritesSection favorites={[]} />);
    expect(screen.queryByTestId("sidebar-favorites-group")).toBeNull();
    expect(screen.queryByTestId("sidebar-favorites-trigger")).toBeNull();
  });

  it("renders the section collapsed by default and hides the item list", () => {
    renderInSidebar(
      <FavoritesSection
        favorites={[
          { id: "art-1", title: "Pipeline risk dashboard" },
          { id: "art-2", title: "Customer overview" },
        ]}
      />,
    );
    expect(screen.getByTestId("sidebar-favorites-group")).toBeTruthy();
    const trigger = screen.getByTestId("sidebar-favorites-trigger");
    expect(trigger.getAttribute("aria-label")).toBe("Toggle Favorites");
    // Radix Collapsible omits the content from the DOM by default when
    // closed, so the list testid should not be present.
    expect(screen.queryByTestId("sidebar-favorites-list")).toBeNull();
  });

  it("expands to show favorited items when the trigger is clicked", () => {
    renderInSidebar(
      <FavoritesSection
        favorites={[
          { id: "art-1", title: "Pipeline risk dashboard" },
          { id: "art-2", title: "Customer overview" },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("sidebar-favorites-trigger"));
    const list = screen.getByTestId("sidebar-favorites-list");
    expect(list).toBeTruthy();
    expect(screen.getByText("Pipeline risk dashboard")).toBeTruthy();
    expect(screen.getByText("Customer overview")).toBeTruthy();
  });

  it("each favorite renders as a link to the artifact detail route", () => {
    renderInSidebar(
      <FavoritesSection
        favorites={[{ id: "art-1", title: "Pipeline risk dashboard" }]}
      />,
    );
    fireEvent.click(screen.getByTestId("sidebar-favorites-trigger"));
    const link = screen.getByRole("link", { name: /pipeline risk dashboard/i });
    expect(link.getAttribute("href")).toBe("/artifacts/art-1");
  });
});
