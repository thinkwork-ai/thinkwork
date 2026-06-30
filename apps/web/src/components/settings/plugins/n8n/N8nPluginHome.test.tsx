import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const home = read("src/components/settings/plugins/n8n/N8nPluginHome.tsx");
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
  it("publishes a settings-only n8n plugin header with native n8n launch", () => {
    expect(home).toContain("title: displayName");
    expect(home).toContain('{ label: "Plugins", href: "/settings/plugins" }');
    expect(home).not.toContain("tabs:");
    expect(home).not.toContain("N8N_WORKFLOWS");
    expect(home).not.toContain("N8N_SETTINGS");
    expect(home).toContain('aria-label="Open n8n UI"');
    expect(home).toContain(
      'window.open(launchUrl, "_blank", "noopener,noreferrer")',
    );
    expect(home).toContain("<ExternalLink");
    expect(home).not.toContain("TabsList");
  });

  it("mounts settings routes and redirects the legacy workflows route", () => {
    expect(n8nRoute).toContain("<N8nPluginHome />");
    expect(settingsRoute).toContain("<N8nPluginHome />");
    expect(workflowsRoute).toContain("redirect({");
    expect(workflowsRoute).toContain('to: "/settings/plugins/n8n"');
    expect(workflowsRoute).toContain("replace: true");
    expect(workflowsRoute).not.toContain("N8nPluginWorkflows");
  });

  it("keeps plugin detail settings-only with an install action", () => {
    expect(home).toContain("SettingsInstallPluginMutation");
    expect(home).toContain("SettingsRefreshPluginCatalogMutation");
    expect(home).toContain("SettingsStartManagedApplicationPlanMutation");
    expect(home).toContain("SettingsUpgradePluginMutation");
    expect(home).toContain("Install");
    expect(home).toContain("Install ${displayName}");
    expect(home).toContain("latest n8n version");
    expect(home).toContain("Update available");
    expect(home).toContain("Install update");
    expect(home).toContain("componentsHeaderAction");
    expect(home).toContain("{componentsHeaderAction}");
    expect(home).toContain('className="mb-3 flex items-center justify-between gap-3"');
    expect(home).toContain("runtimeBlocked");
    expect(home).toContain("Install/Update");
    expect(home).toContain("startN8nInstallUpdatePlan");
    expect(home).toContain("ManagedApplicationPlanDialog");
    expect(home).toContain("n8nDesiredConfigForCurrentDeployment");
    expect(home).toContain('if (normalized === "app.thinkwork.ai") return "thinkwork.ai";');
    expect(
      (home.match(/onClick=\{\(\) => void installN8n\(\)\}/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (home.match(/onClick=\{\(\) => void installUpdate\(\)\}/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(home).toContain("Version metadata");
    expect(home).toContain("Refresh versions");
    expect(home).toContain(
      '${install ? `Installed v${install.pinnedVersion} · ` : ""}Latest v${entry.latestVersion}.',
    );
    expect(home).not.toContain('install?.pinnedVersion ?? "none"');
    expect(home).not.toContain('activeTab === "workflows"');
    expect(home).not.toContain("<N8nPluginWorkflows");
    expect(home).not.toContain("Refresh n8n workflows");
    expect(settings).toContain("<N8nSettings");
  });
});
