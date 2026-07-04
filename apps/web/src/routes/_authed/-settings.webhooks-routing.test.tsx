import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

// THINK-137 U8 (R8): the standalone Settings → Webhooks surface retired. The
// list route redirects to Automations; the detail route resolves the webhook's
// owning Automation and redirects there (else to the Automations index).
describe("Webhooks settings routing retirement", () => {
  it("redirects the webhooks index to Automations", () => {
    const route = source("src/routes/_authed/settings.webhooks.index.tsx");
    expect(route).toContain(
      'redirect({ to: "/settings/automations", replace: true })',
    );
    expect(route).not.toContain("SettingsWebhooks");
  });

  it("redirects the webhook detail to its owning Automation", () => {
    const route = source(
      "src/routes/_authed/settings.webhooks.$webhookId.tsx",
    );
    // Looks up the webhook's agentLoopId and routes to the Automation detail.
    expect(route).toContain("agentLoopId");
    expect(route).toContain('to: "/settings/agent-loops/$agentLoopId"');
    // Falls back to the Automations index when there is no bound loop.
    expect(route).toContain('to: "/settings/automations"');
    expect(route).not.toContain("SettingsWebhookDetail");
  });

  it("removed the standalone webhook settings components", () => {
    for (const file of [
      "src/components/settings/SettingsWebhooks.tsx",
      "src/components/settings/SettingsWebhookDetail.tsx",
    ]) {
      let existed = true;
      try {
        readFileSync(join(root, file), "utf8");
      } catch {
        existed = false;
      }
      expect(existed).toBe(false);
    }
  });
});
