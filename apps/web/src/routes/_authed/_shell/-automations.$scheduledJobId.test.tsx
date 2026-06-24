import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("main Automations shell routes", () => {
  it("renders the user-facing Automations inventory in main navigation", () => {
    const route = source("src/routes/_authed/_shell/automations.index.tsx");

    expect(route).toContain("AgentLoopInventory");
    expect(route).toContain('routeScope="main"');
    expect(route).not.toContain('to: "/settings/automations"');
  });

  it("renders user-facing Automation detail in main navigation", () => {
    const route = source(
      "src/routes/_authed/_shell/automations.$scheduledJobId.tsx",
    );

    expect(route).toContain("AgentLoopDetail");
    expect(route).toContain('routeScope="main"');
    expect(route).not.toContain('to: "/settings/automations/$scheduledJobId"');
  });
});
