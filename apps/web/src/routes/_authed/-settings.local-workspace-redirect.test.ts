import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapLegacyWorkspaceFile } from "./settings.local-workspace";

const routesDir = path.dirname(fileURLToPath(import.meta.url));
const legacyRouteSource = fs.readFileSync(
  path.join(routesDir, "settings.local-workspace.tsx"),
  "utf8",
);
const mainAgentRouteSource = fs.readFileSync(
  path.join(routesDir, "settings.main-agent.tsx"),
  "utf8",
);

describe("legacy /settings/local-workspace route", () => {
  it("redirects to the Main Agent surface instead of rendering the consolidated view", () => {
    expect(legacyRouteSource).toContain("beforeLoad");
    expect(legacyRouteSource).toContain('to: "/settings/main-agent"');
    expect(legacyRouteSource).toContain("throw redirect(");
    // The consolidated editor no longer mounts from this route.
    expect(legacyRouteSource).not.toContain("WorkspaceSettingsView");
    expect(legacyRouteSource).not.toContain("component:");
  });

  it("forwards the ?file= param through the legacy mapping", () => {
    expect(legacyRouteSource).toContain("mapLegacyWorkspaceFile(search.file)");
  });
});

describe("mapLegacyWorkspaceFile", () => {
  it("maps Agent-source paths to source-relative paths", () => {
    expect(mapLegacyWorkspaceFile("Agent/AGENTS.md")).toBe("AGENTS.md");
    expect(mapLegacyWorkspaceFile("Agent/agents/research.md")).toBe(
      "agents/research.md",
    );
    expect(mapLegacyWorkspaceFile("/Agent/skills/web/SKILL.md")).toBe(
      "skills/web/SKILL.md",
    );
  });

  it("drops paths in the other sources — their editors live elsewhere now", () => {
    expect(mapLegacyWorkspaceFile("User/USER.md")).toBeUndefined();
    expect(mapLegacyWorkspaceFile("Spaces/finance/GOAL.md")).toBeUndefined();
  });

  it("drops empty, bare-root, and unsafe values", () => {
    expect(mapLegacyWorkspaceFile(undefined)).toBeUndefined();
    expect(mapLegacyWorkspaceFile("")).toBeUndefined();
    expect(mapLegacyWorkspaceFile("Agent/")).toBeUndefined();
    expect(mapLegacyWorkspaceFile("Agent/../secrets.md")).toBeUndefined();
    expect(mapLegacyWorkspaceFile("AgentX/AGENTS.md")).toBeUndefined();
  });
});

describe("/settings/main-agent route", () => {
  it("validates the ?file= search param and opens it in the scoped editor", () => {
    expect(mainAgentRouteSource).toContain(
      'createFileRoute("/_authed/settings/main-agent")',
    );
    expect(mainAgentRouteSource).toContain("validateSearch");
    expect(mainAgentRouteSource).toContain("defaultOpenFile={file}");
    expect(mainAgentRouteSource).toContain("SettingsMainAgent");
  });
});
