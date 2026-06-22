import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("AgentLoop settings routing", () => {
  it("registers first-class AgentLoop settings routes", () => {
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

  it("moves Settings navigation from Automations to AgentLoops", () => {
    const nav = source("src/components/settings/settings-nav.tsx");
    expect(nav).toContain('label: "AgentLoops"');
    expect(nav).toContain('to: "/settings/agent-loops"');
    expect(nav).not.toContain('label: "Automations"');
  });

  it("redirects the retired Settings Automations index to AgentLoops", () => {
    const route = source("src/routes/_authed/settings.automations.index.tsx");
    expect(route).toContain('redirect({ to: "/settings/agent-loops" })');
    expect(route).not.toContain("SettingsAutomations");
  });
});
