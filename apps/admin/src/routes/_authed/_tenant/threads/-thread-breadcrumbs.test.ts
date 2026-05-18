import { describe, expect, it } from "vitest";
import { buildThreadBreadcrumbs } from "./-thread-breadcrumbs";

const baseThread = {
  identifier: "TW-7",
  number: 7,
  title: "Investigate the bug",
};

describe("buildThreadBreadcrumbs", () => {
  it("uses the Agent breadcrumb when fromAgentId is set", () => {
    const crumbs = buildThreadBreadcrumbs({
      thread: baseThread,
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
      thread: baseThread,
      fromAgentId: "agent-42",
    });

    expect(crumbs[1]).toEqual({ label: "Agent", href: "/agents/agent-42" });
  });

  it("uses the default Threads breadcrumb when there is no Agent provenance", () => {
    const crumbs = buildThreadBreadcrumbs({ thread: baseThread });

    expect(crumbs).toEqual([
      { label: "Threads", href: "/threads" },
      { label: "TW-7 Investigate the bug" },
    ]);
  });

  it("uses the Threads breadcrumb for Computer-owned threads (computerId is ignored)", () => {
    const crumbs = buildThreadBreadcrumbs({
      thread: { ...baseThread, computerId: "comp-1" },
    });

    expect(crumbs).toEqual([
      { label: "Threads", href: "/threads" },
      { label: "TW-7 Investigate the bug" },
    ]);
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
