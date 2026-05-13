import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("agent detail dashboard/editor routes", () => {
  const chromeSource = readSource("../AgentDetailChrome.tsx");
  const dashboardRouteSource = readSource(
    "../../../routes/_authed/_tenant/agents/$agentId.tsx",
  );
  const editorRouteSource = readSource(
    "../../../routes/_authed/_tenant/agents/$agentId_.editor.tsx",
  );
  const workspaceRedirectSource = readSource(
    "../../../routes/_authed/_tenant/agents/$agentId_.workspace.tsx",
  );
  const workspacesRedirectSource = readSource(
    "../../../routes/_authed/_tenant/agents/$agentId_.workspaces.tsx",
  );

  it("exposes dashboard and workspace as first-class agent detail tabs", () => {
    expect(chromeSource).toContain("Dashboard");
    expect(chromeSource).toContain("Workspace");
    expect(chromeSource).toContain('to="/agents/$agentId"');
    expect(chromeSource).toContain('to="/agents/$agentId/editor"');
    expect(chromeSource).toContain("AgentHeaderBadges");
    expect(chromeSource).toContain("AgentRollbackButton");
  });

  it("keeps the dashboard route focused on metrics and activity", () => {
    expect(dashboardRouteSource).toContain('activeTab="dashboard"');
    expect(dashboardRouteSource).toContain("AgentMetrics");
    expect(dashboardRouteSource).toContain("AgentActivity");
  });

  it("removes the old workspace badge from agent detail chrome", () => {
    expect(chromeSource).not.toContain("FolderOpen");
    expect(chromeSource).not.toContain('to="/agents/$agentId/workspace"');
  });

  it("renders the editor route through the shared workspace editor", () => {
    expect(editorRouteSource).toContain('activeTab="editor"');
    expect(editorRouteSource).toContain("WorkspaceEditor");
    expect(editorRouteSource).toContain("initialFolder={folder}");
    expect(editorRouteSource).toContain('className="min-h-[500px]"');
    expect(editorRouteSource).not.toContain("Agent Builder");
  });

  it("redirects legacy workspace routes to the editor tab with folder state", () => {
    expect(workspaceRedirectSource).toContain('to="/agents/$agentId/editor"');
    expect(workspaceRedirectSource).toContain("search={{ folder }}");
    expect(workspacesRedirectSource).toContain('to="/agents/$agentId/editor"');
    expect(workspacesRedirectSource).toContain("search={{ folder }}");
  });
});
