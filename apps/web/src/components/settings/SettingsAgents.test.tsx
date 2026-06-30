import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentsSource = readFileSync(
  join(process.cwd(), "src/components/settings/SettingsAgents.tsx"),
  "utf8",
);
const agentExtensionsSource = readFileSync(
  join(process.cwd(), "src/components/settings/SettingsAgentExtensions.tsx"),
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
const mainAgentRouteSource = readFileSync(
  join(process.cwd(), "src/routes/_authed/settings.main-agent.tsx"),
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
    expect(agentsSource).toContain("SettingsTenantGoalBudgetQuery");
    expect(agentsSource).toContain("SettingsUpdateTenantGoalBudgetMutation");
    expect(agentsSource).toContain('label="Goal token budget"');
    expect(agentsSource).toContain("goalDefaultTokenBudget");
    expect(agentsSource).toContain("validGoalTokenBudgetOrEmpty");
    expect(agentsSource).not.toContain("/settings/local-workspace");
    expect(agentsSource).not.toContain("/settings/main-agent");
    expect(agentsSource).not.toContain("Edit AGENTS.md");

    expect(generalSource).not.toContain("AgentConfigSection");
    expect(generalSource).not.toContain("SettingsTenantAgentQuery");
    expect(generalSource).not.toContain("Default model");
  });

  it("toggles between config and workspace views via the header icon", () => {
    // The header icon flips the page between the config view (Default Agent +
    // Agent Profiles) and the workspace view (main-agent source editor),
    // persisting the active view in the ?view= search param for deep links.
    expect(agentsSource).toContain(
      'useSearch({ from: "/_authed/settings/agents/" })',
    );
    expect(agentsSource).toContain('view === "workspace"');
    expect(agentsSource).toContain('search={{ view: "workspace" }}');
    expect(agentsSource).toContain("search={{}}");
    expect(agentsSource).toContain(
      'aria-label={workspaceView ? "Agent config" : "Workspace files"}',
    );
    // Icon swaps per state: file icon opens the workspace view, sliders icon
    // returns to the config view.
    expect(agentsSource).toContain("FileCode");
    expect(agentsSource).toContain("SlidersHorizontal");
    // The workspace view reuses the main-agent editor component (AGENTS.md
    // default-open) and forwards the optional ?file= deep link.
    expect(agentsSource).toContain("SettingsMainAgent");
    expect(agentsSource).toContain(
      "<SettingsMainAgent defaultOpenFile={file} />",
    );
    // The route validates both search params.
    expect(routeSource).toContain("validateSearch");
    expect(routeSource).toContain('search.view === "workspace"');
    expect(routeSource).toContain("isSafeWorkspaceFile(search.file)");
  });

  it("publishes the real header-bar breadcrumb for both views", () => {
    // The page drives SettingsHeaderBar via usePageHeaderActions: config view
    // is a single "Agents" crumb; workspace view reads "Agents > Workspace"
    // with "Agents" clickable to return to the config view (empty search
    // clears ?view=). No SettingsHeader wrapper — the page owns the header.
    expect(agentsSource).toContain("usePageHeaderActions({");
    expect(agentsSource).toContain(
      '{ label: "Agents", href: "/settings/agents", search: {} }',
    );
    expect(agentsSource).toContain('{ label: "Workspace" }');
    expect(agentsSource).toContain('[{ label: "Agents" }]');
    expect(agentsSource).not.toContain("<SettingsHeader");
  });

  it("renders the workspace view full-bleed without the in-body title block", () => {
    // No SettingsPageTitle/description in workspace view — the editor fills
    // the full content pane directly under the breadcrumb bar.
    expect(agentsSource).not.toContain("Edit the main Agent source");
    expect(agentsSource).toContain('<div className="h-full min-h-0">');
    // The config view keeps its normal in-body page title.
    expect(agentsSource).toContain(
      "Configure the default Agent and reusable task profiles",
    );
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
    // Profile markdown is edited through the embedded scoped editor on the
    // detail page (agents/ subtree of the agent source), not a deep link into
    // the retired consolidated workspace page.
    expect(agentsSource).toContain("ProfileWorkspaceSection");
    expect(agentsSource).toContain("ScopedWorkspaceEditor");
    expect(agentsSource).toContain('pathPrefix="agents/"');
    expect(agentsSource).toContain("defaultOpenFile={`${profileSlug}.md`}");
    expect(agentsSource).not.toContain("Open Agent Profile markdown");
    expect(agentsSource).not.toContain("Advanced editor");
    expect(agentsSource).toContain("text-[#54a9ff]");
    expect(agentsSource).toContain("{builtIns} Tools");
    expect(agentsSource).toContain("{mcps} MCP");
    expect(agentsSource).toContain("{skills} Skills");
    expect(agentsSource).toContain("{extensionCount} Extensions");
    expect(agentsSource).toContain("All Spaces");
    expect(agentsSource).not.toContain("{builtIns} built-ins");
    expect(agentsSource).not.toContain("all Spaces");
  });

  it("renders Pi Extensions between Default Agent and Agent Profiles", () => {
    const defaultAgentIndex = agentsSource.indexOf("<AgentConfigSection");
    const extensionsIndex = agentsSource.indexOf("<SettingsAgentExtensions");
    const profilesIndex = agentsSource.indexOf('label="Agent Profiles"');

    expect(defaultAgentIndex).toBeGreaterThan(-1);
    expect(extensionsIndex).toBeGreaterThan(defaultAgentIndex);
    expect(profilesIndex).toBeGreaterThan(extensionsIndex);
    expect(agentsSource).toContain("SettingsPiExtensionsQuery");
    expect(agentsSource).toContain("SettingsPiExtensionFieldsFragment");
    expect(agentsSource).toContain("useFragment(");
    expect(agentsSource).toContain("enabledExtensionCountsByProfileId");
    expect(agentExtensionsSource).toContain('label="Extensions"');
    expect(agentExtensionsSource).toContain("GitHub import");
  });

  it("keeps the full-bleed workspace view separate from Extensions", () => {
    const workspaceReturnIndex = agentsSource.indexOf(
      "<SettingsMainAgent defaultOpenFile={file} />",
    );
    const extensionsIndex = agentsSource.indexOf("<SettingsAgentExtensions");

    expect(workspaceReturnIndex).toBeGreaterThan(-1);
    expect(extensionsIndex).toBeGreaterThan(workspaceReturnIndex);
    expect(agentsSource).toContain("if (workspaceView)");
  });

  it("wires Pi Extension import, review, and assignment mutations", () => {
    expect(queriesSource).toContain("query SettingsPiExtensions");
    expect(queriesSource).toContain("fragment SettingsPiExtensionFields");
    expect(queriesSource).toContain(
      "mutation SettingsImportPiExtensionFromGitHub",
    );
    expect(queriesSource).toContain(
      "mutation SettingsApprovePiExtensionVersion",
    );
    expect(queriesSource).toContain(
      "mutation SettingsRejectPiExtensionVersion",
    );
    expect(queriesSource).toContain(
      "mutation SettingsUpdatePiExtensionAssignment",
    );
    expect(agentExtensionsSource).toContain(
      "SettingsImportPiExtensionFromGitHubMutation",
    );
    expect(agentExtensionsSource).toContain(
      "SettingsApprovePiExtensionVersionMutation",
    );
    expect(agentExtensionsSource).toContain(
      "SettingsRejectPiExtensionVersionMutation",
    );
    expect(agentExtensionsSource).toContain(
      "SettingsUpdatePiExtensionAssignmentMutation",
    );
  });

  it("uses Pi extension language and disables assignments outside approved state", () => {
    expect(agentExtensionsSource).toContain("Pi extension");
    expect(agentExtensionsSource).toContain("Failed verification");
    expect(agentExtensionsSource).toContain(
      "Assignment unavailable: this Pi extension failed verification.",
    );
    expect(agentExtensionsSource).toContain(
      "Assignment unavailable: this Pi extension was rejected.",
    );
    expect(agentExtensionsSource).toContain(
      "Assignment unavailable until an operator approves this Pi extension.",
    );
    expect(agentExtensionsSource).toContain(
      "PiExtensionVersionStatus.Approved",
    );
    expect(agentExtensionsSource).toContain(
      "disabled={!approved || assigning}",
    );
    expect(agentExtensionsSource).not.toContain("Built-in Tools");
    expect(agentExtensionsSource).not.toContain("MCP Servers");
    expect(agentExtensionsSource).not.toContain("Installed skills");
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
    // The old standalone Main Agent route now redirects into the Agents
    // workspace view, preserving ?file=.
    expect(mainAgentRouteSource).toContain("throw redirect(");
    expect(mainAgentRouteSource).toContain('to: "/settings/agents"');
    expect(mainAgentRouteSource).toContain('view: "workspace"');
    expect(mainAgentRouteSource).toContain("file: search.file");
  });
});
