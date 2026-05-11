import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const { updateArtifactMock, toastSuccessMock, toastErrorMock, queryDocs } =
  vi.hoisted(() => ({
    updateArtifactMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
    queryDocs: {
      FavoriteArtifactsQuery: Symbol("FavoriteArtifactsQuery"),
      UpdateArtifactMutation: Symbol("UpdateArtifactMutation"),
    },
  }));

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
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.UpdateArtifactMutation)
      return [{ fetching: false }, updateArtifactMock];
    return [{ fetching: false }, vi.fn()];
  },
}));

vi.mock("@/lib/graphql-queries", () => queryDocs);

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    warning: (...args: unknown[]) => vi.fn()(...args),
  },
}));

import { FavoritesSection } from "./FavoritesSection";

function renderInSidebar(node: React.ReactNode) {
  return render(
    <TooltipProvider>
      <SidebarProvider>{node}</SidebarProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  updateArtifactMock.mockReset();
  updateArtifactMock.mockResolvedValue({});
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});
afterEach(cleanup);

describe("FavoritesSection (Pinned)", () => {
  it("renders nothing when there are zero pinned artifacts", () => {
    renderInSidebar(<FavoritesSection favorites={[]} />);
    expect(screen.queryByTestId("sidebar-pinned-group")).toBeNull();
    expect(screen.queryByTestId("sidebar-pinned-trigger")).toBeNull();
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
    expect(screen.getByTestId("sidebar-pinned-group")).toBeTruthy();
    const trigger = screen.getByTestId("sidebar-pinned-trigger");
    expect(trigger.getAttribute("aria-label")).toBe("Toggle Pinned");
    // Radix Collapsible omits the content from the DOM by default when
    // closed, so the list testid should not be present.
    expect(screen.queryByTestId("sidebar-pinned-list")).toBeNull();
  });

  it("expands to show pinned items when the trigger is clicked", () => {
    renderInSidebar(
      <FavoritesSection
        favorites={[
          { id: "art-1", title: "Pipeline risk dashboard" },
          { id: "art-2", title: "Customer overview" },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("sidebar-pinned-trigger"));
    const list = screen.getByTestId("sidebar-pinned-list");
    expect(list).toBeTruthy();
    expect(screen.getByText("Pipeline risk dashboard")).toBeTruthy();
    expect(screen.getByText("Customer overview")).toBeTruthy();
  });

  it("each pinned row renders as a link to the artifact detail route", () => {
    renderInSidebar(
      <FavoritesSection
        favorites={[{ id: "art-1", title: "Pipeline risk dashboard" }]}
      />,
    );
    fireEvent.click(screen.getByTestId("sidebar-pinned-trigger"));
    const link = screen.getByRole("link", { name: /pipeline risk dashboard/i });
    expect(link.getAttribute("href")).toBe("/artifacts/art-1");
  });

  it("each pinned row renders an inline unpin button", () => {
    renderInSidebar(
      <FavoritesSection
        favorites={[
          {
            id: "art-1",
            title: "Pipeline risk dashboard",
            favoritedAt: "2026-05-10T18:00:00.000Z",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("sidebar-pinned-trigger"));
    const button = screen.getByTestId("sidebar-pinned-toggle-art-1");
    expect(button.getAttribute("aria-label")).toBe("Unpin artifact");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking the inline unpin button fires UpdateArtifactMutation with favoritedAt: null", async () => {
    renderInSidebar(
      <FavoritesSection
        favorites={[
          {
            id: "art-1",
            title: "Pipeline risk dashboard",
            favoritedAt: "2026-05-10T18:00:00.000Z",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("sidebar-pinned-trigger"));
    fireEvent.click(screen.getByTestId("sidebar-pinned-toggle-art-1"));
    await waitFor(() => {
      expect(updateArtifactMock).toHaveBeenCalledWith({
        id: "art-1",
        input: { favoritedAt: null },
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Unpinned.");
  });

  it("clicking the inline unpin button does not navigate to the artifact", async () => {
    renderInSidebar(
      <FavoritesSection
        favorites={[
          {
            id: "art-1",
            title: "Pipeline risk dashboard",
            favoritedAt: "2026-05-10T18:00:00.000Z",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("sidebar-pinned-trigger"));
    const link = screen.getByRole("link", { name: /pipeline risk dashboard/i });
    const linkClickSpy = vi.fn();
    link.addEventListener("click", linkClickSpy);
    fireEvent.click(screen.getByTestId("sidebar-pinned-toggle-art-1"));
    await waitFor(() => {
      expect(updateArtifactMock).toHaveBeenCalled();
    });
    expect(linkClickSpy).not.toHaveBeenCalled();
  });

  it("surfaces toast.error when the mutation returns an error result", async () => {
    updateArtifactMock.mockResolvedValueOnce({
      error: { message: "boom" },
    });
    renderInSidebar(
      <FavoritesSection
        favorites={[
          {
            id: "art-1",
            title: "Pipeline risk dashboard",
            favoritedAt: "2026-05-10T18:00:00.000Z",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("sidebar-pinned-trigger"));
    fireEvent.click(screen.getByTestId("sidebar-pinned-toggle-art-1"));
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("Could not unpin artifact: boom"),
      );
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
