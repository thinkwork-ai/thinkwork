import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const home = read("src/components/settings/plugins/n8n/N8nPluginHome.tsx");
const workflows = read(
  "src/components/settings/plugins/n8n/N8nPluginWorkflows.tsx",
);
const settings = read(
  "src/components/settings/plugins/n8n/N8nPluginSettings.tsx",
);
const n8nRoute = read("src/routes/_authed/settings.plugins.n8n.tsx");
const workflowsRoute = read(
  "src/routes/_authed/settings.plugins.n8n.workflows.tsx",
);
const settingsRoute = read(
  "src/routes/_authed/settings.plugins.n8n.settings.tsx",
);

describe("N8nPluginHome", () => {
  it("publishes route-backed Workflows and Settings tabs in the header", () => {
    expect(home).toContain("title: displayName");
    expect(home).toContain('{ label: "Plugins", href: "/settings/plugins" }');
    expect(home).toContain('{ to: N8N_WORKFLOWS, label: "Workflows" }');
    expect(home).toContain('{ to: N8N_SETTINGS, label: "Settings" }');
    expect(home).toContain('aria-label="Open n8n UI"');
    expect(home).toContain(
      'window.open(launchUrl, "_blank", "noopener,noreferrer")',
    );
    expect(home).toContain("<ExternalLink");
    expect(home).not.toContain("TabsList");
  });

  it("mounts the n8n plugin home across the n8n plugin tab routes", () => {
    expect(n8nRoute).toContain('<N8nPluginHome tab="workflows"');
    expect(workflowsRoute).toContain('<N8nPluginHome tab="workflows"');
    expect(settingsRoute).toContain('<N8nPluginHome tab="settings"');
  });

  it("keeps workflow discovery separate from package/runtime settings", () => {
    expect(workflows).toContain("SettingsDiscoverN8nWorkflowsQuery");
    expect(workflows).toContain("SettingsConnectN8nWorkflowMutation");
    expect(workflows).toContain("<DataTable");
    expect(workflows).toContain("No n8n workflows have been discovered yet.");
    expect(home).toContain('activeTab === "workflows"');
    expect(home).toContain("<N8nPluginWorkflows");
    expect(settings).toContain("<N8nSettings");
  });
});
