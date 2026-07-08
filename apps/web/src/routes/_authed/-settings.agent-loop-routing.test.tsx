import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

// THINK-218: Automations and Agent Loops collapse into the unified Workflows
// section — every legacy Settings route under these families now redirects
// to /settings/workflows rather than rendering AgentLoop internals directly.
describe("Automation/Agent Loop settings routing (collapsed into Workflows)", () => {
  it("redirects the legacy Automation index and detail routes to Workflows", () => {
    const index = source("src/routes/_authed/settings.automations.index.tsx");
    expect(index).toContain('"/_authed/settings/automations/"');
    expect(index).toContain('redirect({ to: "/settings/workflows" })');
    expect(index).not.toContain("AgentLoopInventory");

    const detail = source(
      "src/routes/_authed/settings.automations.$automationId.tsx",
    );
    expect(detail).toContain('"/_authed/settings/automations/$automationId"');
    expect(detail).toContain('redirect({ to: "/settings/workflows" })');
    expect(detail).not.toContain("AgentLoopDetail");
  });

  it("redirects the legacy Agent Loop index, detail, and run routes to Workflows", () => {
    const index = source("src/routes/_authed/settings.agent-loops.index.tsx");
    expect(index).toContain('"/_authed/settings/agent-loops/"');
    expect(index).toContain('redirect({ to: "/settings/workflows" })');

    const detail = source(
      "src/routes/_authed/settings.agent-loops.$agentLoopId.tsx",
    );
    expect(detail).toContain('"/_authed/settings/agent-loops/$agentLoopId"');
    expect(detail).toContain('redirect({ to: "/settings/workflows" })');
    expect(detail).not.toContain("AgentLoopDetail");

    const run = source(
      "src/routes/_authed/settings.agent-loops.$agentLoopId_.runs.$runId.tsx",
    );
    expect(run).toContain(
      '"/_authed/settings/agent-loops/$agentLoopId_/runs/$runId"',
    );
    expect(run).toContain('redirect({ to: "/settings/workflows" })');
    expect(run).not.toContain("AgentLoopRunDetail");

    expect(source("src/routeTree.gen.ts")).toContain(
      'fullPath: "/settings/agent-loops/$agentLoopId/runs/$runId"',
    );
  });

  it("no longer lists Automations as a Settings navigation route (collapsed into Workflows)", () => {
    const nav = source("src/components/settings/settings-nav.tsx");
    expect(nav).not.toContain('label: "Automations"');
    expect(nav).not.toContain('to: "/settings/automations"');
    expect(nav).toContain('label: "Workflows"');
    expect(nav).toContain('to: "/settings/workflows"');
  });
});
