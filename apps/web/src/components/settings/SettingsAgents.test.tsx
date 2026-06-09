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
const builtInProfilesSource = readFileSync(
  join(
    process.cwd(),
    "../../packages/api/src/graphql/resolvers/agent-profiles/built-in-agent-profiles.ts",
  ),
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
    expect(agentsSource).toContain('label="Loop / Review"');
    expect(agentsSource).toContain('label="Closed loop"');
    expect(agentsSource).toContain('label="Max iterations"');
    expect(agentsSource).toContain('label="Review gate"');
    expect(agentsSource).toContain('label="External reviewer"');
    expect(agentsSource).toContain('label="Max review loops"');
    expect(agentsSource).toContain('label="Failure behavior"');
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

  it("saves Agent Profile loop controls into executionControls.loopPolicy", () => {
    expect(agentsSource).toContain("loopEnabled");
    expect(agentsSource).toContain("loopMode");
    expect(agentsSource).toContain("loopMaxIterations");
    expect(agentsSource).toContain("loopReviewGate");
    expect(agentsSource).toContain("loopExternalReviewerPolicy");
    expect(agentsSource).toContain("loopMaxReviewLoops");
    expect(agentsSource).toContain("loopFailBehavior");
    expect(agentsSource).toContain("loopPolicy = {");
    expect(agentsSource).toContain("mode: draft.loopMode");
    expect(agentsSource).toContain("enabled: draft.loopEnabled");
    expect(agentsSource).toContain(
      "maxIterations: positiveIntegerOrDefault(draft.loopMaxIterations, 1)",
    );
    expect(agentsSource).toContain(
      "maxReviewLoops: positiveIntegerOrDefault(draft.loopMaxReviewLoops, 1)",
    );
    expect(agentsSource).toContain("reviewGate: draft.loopReviewGate");
    expect(agentsSource).toContain(
      "externalReviewerPolicy: draft.loopExternalReviewerPolicy",
    );
    expect(agentsSource).toContain("failBehavior: draft.loopFailBehavior");
    expect(agentsSource).toContain("loopPolicy,");
  });

  it("blocks invalid loop limits before saving", () => {
    expect(agentsSource).toContain(
      "validPositiveInteger(draft.loopMaxIterations)",
    );
    expect(agentsSource).toContain(
      "validPositiveInteger(draft.loopMaxReviewLoops)",
    );
    expect(agentsSource).toContain(
      'toast.error("Loop limits must be positive whole numbers")',
    );
    expect(agentsSource).toContain("disabled={saving || !draftValid}");
    expect(agentsSource).toContain("Number.isSafeInteger(number)");
  });

  it("keeps the built-in Reviewer wired as a review-gated closed loop", () => {
    expect(builtInProfilesSource).toContain('built_in_key: "reviewer"');
    expect(builtInProfilesSource).toContain("reviewGate: true");
    expect(builtInProfilesSource).toContain("maxReviewLoops: 2");
    expect(builtInProfilesSource).toContain('externalReviewerPolicy: "never"');
    expect(builtInProfilesSource).toContain("defaultAgentLoopPolicy({");
    expect(agentsSource).toContain("function loopDefaultsForProfile");
    expect(agentsSource).toContain('profile.builtInKey !== "reviewer"');
    expect(agentsSource).toContain('externalReviewerPolicy: "never"');
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
