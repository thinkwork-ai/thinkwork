import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => <a href={to.replace("$id", params?.id ?? "$id")}>{children}</a>,
}));

vi.mock("@thinkwork/ui", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  SidebarGroup: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

import { GlobalInboxSection } from "./GlobalInboxSection";

afterEach(cleanup);

describe("GlobalInboxSection", () => {
  it("renders unread inbox rows as compact title-only items", () => {
    render(
      <GlobalInboxSection
        totalCount={1}
        threads={[
          {
            id: "thread-1",
            title: "Blog Post on Mentions V2 Project",
            spaceId: "space-1",
            space: { id: "space-1", name: "Marketing" },
            lastActivityAt: "2026-05-19T18:00:00Z",
            lastReadAt: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Inbox (1)")).toBeTruthy();
    expect(screen.getByText("Blog Post on Mentions V2 Project")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /blog post on mentions v2 project/i })
        .getAttribute("href"),
    ).toBe("/threads/thread-1");
    expect(screen.queryByText("Marketing")).toBeNull();
    expect(screen.getByRole("button", { name: /mark as read/i })).toBeTruthy();
  });

  it("contains query errors inside the section", () => {
    render(<GlobalInboxSection totalCount={0} threads={[]} error="Nope" />);

    expect(screen.getByText("Nope")).toBeTruthy();
    expect(screen.queryByText("No unread threads")).toBeNull();
  });
});
