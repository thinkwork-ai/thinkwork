import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentsSource = readFileSync(
  join(process.cwd(), "src/components/settings/SettingsAgents.tsx"),
  "utf8",
);
const generalSource = readFileSync(
  join(process.cwd(), "src/components/settings/SettingsGeneral.tsx"),
  "utf8",
);
const queriesSource = readFileSync(
  join(process.cwd(), "src/lib/settings-queries.ts"),
  "utf8",
);
const routeSource = readFileSync(
  join(process.cwd(), "src/routes/_authed/settings.agents.index.tsx"),
  "utf8",
);
const detailRouteSource = readFileSync(
  join(process.cwd(), "src/routes/_authed/settings.agents.$profileId.tsx"),
  "utf8",
);

describe("SettingsAgents page", () => {
  it("owns the default Agent configuration that used to live in General", () => {
    expect(agentsSource).toContain('title="Agents"');
    expect(agentsSource).toContain('label="Default Agent"');
    expect(agentsSource).toContain("SettingsTenantAgentQuery");
    expect(agentsSource).toContain("SettingsUpdateTenantAgentMutation");

    expect(generalSource).not.toContain("AgentConfigSection");
    expect(generalSource).not.toContain("SettingsTenantAgentQuery");
    expect(generalSource).not.toContain("Default model");
  });

  it("renders Agent Profiles with model, capability, Space, and execution controls", () => {
    expect(agentsSource).toContain('label="Agent Profiles"');
    expect(agentsSource).toContain("SettingsAgentProfilesQuery");
    expect(agentsSource).toContain("SettingsUpdateAgentProfileMutation");
    expect(agentsSource).toContain('to: "/settings/agents/$profileId"');
    expect(agentsSource).toContain("SettingsAgentProfileDetail");
    expect(agentsSource).toContain("builtInTools");
    expect(agentsSource).toContain("mcpServers");
    expect(agentsSource).toContain("skillSlugs");
    expect(agentsSource).toContain("spaceIds");
    expect(agentsSource).toContain("maxRuntimeMs");
    expect(agentsSource).toContain("maxTokens");
  });

  it("queries the editor catalog and protects the route for operators", () => {
    expect(queriesSource).toContain("query SettingsAgentProfiles");
    expect(queriesSource).toContain("agentProfileEditorCatalog");
    expect(queriesSource).toContain("mutation SettingsCreateAgentProfile");
    expect(queriesSource).toContain("mutation SettingsDeleteAgentProfile");
    expect(routeSource).toContain("OperatorGuard");
    expect(routeSource).toContain('"/_authed/settings/agents/"');
    expect(detailRouteSource).toContain("OperatorGuard");
    expect(detailRouteSource).toContain(
      '"/_authed/settings/agents/$profileId"',
    );
  });
});
