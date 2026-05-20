import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string>;
  }) => (
    <a
      href={`${to}${search?.spaceId ? `?spaceId=${search.spaceId}` : ""}`}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock("@thinkwork/ui", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  SidebarGroup: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <ul>{children}</ul>
  ),
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => children,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
}));

import { SpaceNavSection } from "./SpaceNavSection";

afterEach(cleanup);

describe("SpaceNavSection", () => {
  it("links Spaces into Chat context and shows unread counts", () => {
    render(
      <SpaceNavSection
        activeSpaceId="space-1"
        spaces={[
          {
            id: "space-1",
            slug: "customer-onboarding",
            name: "Customer Onboarding",
            unreadThreadCount: 3,
            lastActivityAt: "2026-05-19T18:00:00Z",
          },
        ]}
      />,
    );

    const link = screen.getByRole("link", { name: /customer onboarding/i });
    expect(link.getAttribute("href")).toBe("/threads?spaceId=space-1");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("keeps the Space nav usable when there are no Spaces", () => {
    render(<SpaceNavSection activeSpaceId={null} spaces={[]} />);

    expect(screen.getByText("Spaces")).toBeTruthy();
    expect(screen.getByText("No Spaces yet")).toBeTruthy();
  });
});
