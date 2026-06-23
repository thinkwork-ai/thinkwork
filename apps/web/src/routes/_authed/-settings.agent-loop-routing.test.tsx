import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("Automation settings routing", () => {
  it("registers first-class Automation settings routes backed by AgentLoop internals", () => {
    expect(
      source("src/routes/_authed/settings.automations.index.tsx"),
    ).toContain('"/_authed/settings/automations/"');
    expect(
      source("src/routes/_authed/settings.automations.index.tsx"),
    ).toContain("AgentLoopInventory");
    expect(
      source("src/routes/_authed/settings.agent-loops.index.tsx"),
    ).toContain('"/_authed/settings/agent-loops/"');
    expect(
      source("src/routes/_authed/settings.agent-loops.$agentLoopId.tsx"),
    ).toContain('"/_authed/settings/agent-loops/$agentLoopId"');
    expect(
      source(
        "src/routes/_authed/settings.agent-loops.$agentLoopId_.runs.$runId.tsx",
      ),
    ).toContain('"/_authed/settings/agent-loops/$agentLoopId_/runs/$runId"');
    expect(source("src/routeTree.gen.ts")).toContain(
      'fullPath: "/settings/agent-loops/$agentLoopId/runs/$runId"',
    );
  });

  it("uses Automations as the preferred Settings navigation route", () => {
    const nav = source("src/components/settings/settings-nav.tsx");
    expect(nav).toContain('label: "Automations"');
    expect(nav).toContain('to: "/settings/automations"');
  });

  it("redirects the legacy AgentLoop index to the preferred Automation route", () => {
    const route = source("src/routes/_authed/settings.agent-loops.index.tsx");
    expect(route).toContain('redirect({ to: "/settings/automations" })');
    expect(route).not.toContain("AgentLoopInventory");
  });

  it("keeps Settings scheduled-job detail as a compatibility inspector", () => {
    const route = source(
      "src/routes/_authed/settings.automations.$scheduledJobId.tsx",
    );
    const detail = source(
      "src/components/scheduled-jobs/ScheduledJobDetail.tsx",
    );

    expect(route).toContain("ScheduledJobDetail");
    expect(route).toContain('backHref="/settings/automations"');
    expect(detail).toContain("Scheduled-job compatibility detail");
    expect(detail).toContain('label: "Scheduled jobs"');
  });
});
