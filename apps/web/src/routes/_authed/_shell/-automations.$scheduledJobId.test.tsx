import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("retired Automations shell routes", () => {
  it("redirects the old main Automations surface to the preferred Settings route", () => {
    const route = source("src/routes/_authed/_shell/automations.index.tsx");

    expect(route).toContain('redirect({ to: "/settings/automations" })');
    expect(route).not.toContain("AutomationsPage");
    expect(route).not.toContain("ScheduledJobForm");
  });

  it("preserves old scheduled-job detail deep links as Settings compatibility links", () => {
    const route = source(
      "src/routes/_authed/_shell/automations.$scheduledJobId.tsx",
    );

    expect(route).toContain('to: "/settings/automations/$scheduledJobId"');
    expect(route).not.toContain("ScheduledJobDetail");
  });
});
