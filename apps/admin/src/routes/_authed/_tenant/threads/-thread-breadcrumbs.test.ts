import { describe, expect, it } from "vitest";
import { buildThreadBreadcrumbs } from "./-thread-breadcrumbs";

const baseThread = {
  identifier: "TW-7",
  number: 7,
  title: "Investigate the bug",
};

describe("buildThreadBreadcrumbs", () => {
  it("routes Computer-owned threads through /computers/$computerId", () => {
    const crumbs = buildThreadBreadcrumbs({
      thread: { ...baseThread, computerId: "comp-1" },
    });

    expect(crumbs).toEqual([
      { label: "Computers", href: "/computers" },
      { label: "Computer", href: "/computers/comp-1" },
      { label: "TW-7 Investigate the bug" },
    ]);
  });

  it("preserves the Agent breadcrumb when fromAgentId is set and the thread is not Computer-owned", () => {
    const crumbs = buildThreadBreadcrumbs({
      thread: { ...baseThread, computerId: null },
      fromAgentId: "agent-42",
      fromAgentName: "Marco",
    });

    expect(crumbs).toEqual([
      { label: "Agents", href: "/agents" },
      { label: "Marco", href: "/agents/agent-42" },
      { label: "TW-7 Investigate the bug" },
    ]);
  });

  it("falls back to a literal 'Agent' label when fromAgentName is missing", () => {
    const crumbs = buildThreadBreadcrumbs({
      thread: { ...baseThread, computerId: null },
      fromAgentId: "agent-42",
    });

    expect(crumbs[1]).toEqual({ label: "Agent", href: "/agents/agent-42" });
  });

  it("uses the default Threads breadcrumb when there is neither Computer ownership nor an Agent provenance", () => {
    const crumbs = buildThreadBreadcrumbs({
      thread: { ...baseThread, computerId: null },
    });

    expect(crumbs).toEqual([
      { label: "Threads", href: "/threads" },
      { label: "TW-7 Investigate the bug" },
    ]);
  });

  it("prefers Computer ownership over an Agent provenance query param", () => {
    const crumbs = buildThreadBreadcrumbs({
      thread: { ...baseThread, computerId: "comp-1" },
      fromAgentId: "agent-42",
      fromAgentName: "Marco",
    });

    expect(crumbs[0]).toEqual({ label: "Computers", href: "/computers" });
    expect(crumbs[1]?.href).toBe("/computers/comp-1");
  });

  it("renders 'Loading...' as the tail crumb when the thread payload has not arrived", () => {
    const crumbs = buildThreadBreadcrumbs({ thread: null });

    expect(crumbs[crumbs.length - 1]).toEqual({ label: "Loading..." });
  });

  it("uses #<number> when the thread has no identifier", () => {
    const crumbs = buildThreadBreadcrumbs({
      thread: { number: 12, title: "No identifier", identifier: null },
    });

    expect(crumbs[crumbs.length - 1]).toEqual({ label: "#12 No identifier" });
  });
});
