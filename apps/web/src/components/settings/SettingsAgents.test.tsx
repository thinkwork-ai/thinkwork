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
const workspaceRouteSource = readFileSync(
  join(process.cwd(), "src/routes/_authed/settings.local-workspace.tsx"),
  "utf8",
);

describe("SettingsAgents page", () => {
  it("owns the default Agent configuration that used to live in General", () => {
    expect(agentsSource).toContain('title="Agents"');
    expect(agentsSource).toContain('label="Default Agent"');
    expect(agentsSource).toContain("SettingsTenantAgentQuery");
    expect(agentsSource).toContain("SettingsUpdateTenantAgentMutation");
    expect(agentsSource).toContain('search={{ file: "Agent/AGENTS.md" }}');
    expect(agentsSource).toContain('aria-label="Open AGENTS.md"');
    expect(agentsSource).not.toContain("Edit AGENTS.md");

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
    expect(agentsSource).toContain("agentProfileWorkspacePath");
    expect(agentsSource).toContain("Agent/agents/${profile.slug}.md");
    expect(agentsSource).toContain("Open Agent Profile markdown");
    expect(agentsSource).not.toContain("Advanced editor");
    expect(agentsSource).toContain("text-[#54a9ff]");
    expect(agentsSource).toContain("{builtIns} Tools");
    expect(agentsSource).toContain("{mcps} MCP");
    expect(agentsSource).toContain("{skills} Skills");
    expect(agentsSource).toContain("All Spaces");
    expect(agentsSource).not.toContain("{builtIns} built-ins");
    expect(agentsSource).not.toContain("all Spaces");
  });

  it("keeps Agent Profile multi-select chips bounded inside settings rows", () => {
    expect(agentsSource).toContain('className="w-full max-w-[32rem] min-w-0"');
    expect(agentsSource).toContain(
      "const visibleCount = Math.max(options.length, values.length, 1);",
    );
    expect(agentsSource).toContain("maxCount={visibleCount}");
    expect(agentsSource).toContain('maxWidth="32rem"');
    expect(agentsSource).toContain("dark:bg-input/30");
    expect(agentsSource).toContain(
      'popoverClassName="w-[var(--radix-popover-trigger-width)] max-w-[32rem]"',
    );
    expect(agentsSource).not.toContain("singleLine");
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
    expect(workspaceRouteSource).toContain("validateSearch");
    expect(workspaceRouteSource).toContain("defaultOpenFile={file}");
  });
});
