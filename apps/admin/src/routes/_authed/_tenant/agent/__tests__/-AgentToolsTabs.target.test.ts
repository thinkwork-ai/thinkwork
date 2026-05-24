import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("agent detail tools tabs", () => {
  const layoutSource = readSource("../../agent.tsx");
  const indexSource = readSource("../index.tsx");
  const configSource = readSource("../config.tsx");
  const builtinToolsSource = readSource("../tools.tsx");
  const mcpServersSource = readSource("../mcp-servers.tsx");
  const sidebarSource = readSource("../../../../../components/Sidebar.tsx");
  const headerControlsSource = readSource(
    "../../../../../components/tenant-agent/TenantAgentHeaderControls.tsx",
  );

  it("keeps agent defaulting to files", () => {
    expect(indexSource).toContain('to: "/agent/files"');
  });

  it("moves built-in tools and MCP servers into agent tabs", () => {
    expect(layoutSource).toContain('to: "/agent/tools"');
    expect(layoutSource).toContain('label: "Tools"');
    expect(layoutSource).not.toContain("Built-in Tools");
    expect(layoutSource).toContain('to: "/agent/mcp-servers"');
    expect(layoutSource).toContain("MCP Servers");
    expect(layoutSource).not.toContain("/capabilities");
  });

  it("registers the tenant skill catalog tab", () => {
    expect(layoutSource).toContain('"skills"');
    expect(layoutSource).toContain('to: "/agent/skills"');
    expect(layoutSource).toContain('label: "Skills"');
    expect(layoutSource).toContain('pathname.startsWith("/agent/skills")');
  });

  it("renames files to workspace and removes config from the tab strip", () => {
    expect(layoutSource).toContain('label: "Workspace"');
    expect(layoutSource).not.toContain('label: "Files"');
    expect(layoutSource).not.toContain('label: "Config"');
    expect(layoutSource).not.toContain('to: "/agent/config"');
    expect(configSource).toContain('to: "/agent/files"');
    expect(configSource).toContain("replace: true");
  });

  it("renders model and runtime selectors in the agent header", () => {
    expect(layoutSource).toContain("TenantAgentHeaderControls");
    expect(headerControlsSource).toContain("BadgeSelectorSelect");
    expect(headerControlsSource).toContain("ModelCatalogQuery");
    expect(headerControlsSource).toContain("UpdateTenantAgentMutation");
    expect(headerControlsSource).toContain('label: "Pi"');
    expect(headerControlsSource).toContain('label: "Strands"');
  });

  it("orders runtime before model in the agent header controls", () => {
    expect(headerControlsSource.indexOf("value={agent.runtime}")).toBeLessThan(
      headerControlsSource.indexOf("value={currentModel}"),
    );
  });

  it("mounts the tool tabs under agent routes", () => {
    expect(builtinToolsSource).toContain(
      '"/_authed/_tenant/agent/tools"',
    );
    expect(mcpServersSource).toContain(
      '"/_authed/_tenant/agent/mcp-servers"',
    );
    expect(builtinToolsSource).toContain("Agent access");
    expect(builtinToolsSource).toContain("tenant platform agent used by chat");
    expect(mcpServersSource).toContain(
      "make it available to the tenant platform agent",
    );
  });

  it("removes the standalone Tools navigation item", () => {
    expect(sidebarSource).not.toContain('to: "/capabilities"');
    expect(sidebarSource).not.toContain('label: "Tools"');
  });
});
