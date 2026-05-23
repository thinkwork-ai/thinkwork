import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("agent detail tools tabs", () => {
  const layoutSource = readSource("../../agent.tsx");
  const indexSource = readSource("../index.tsx");
  const builtinToolsSource = readSource("../tools.tsx");
  const mcpServersSource = readSource("../mcp-servers.tsx");
  const sidebarSource = readSource("../../../../../components/Sidebar.tsx");

  it("keeps agent defaulting to files", () => {
    expect(indexSource).toContain('to: "/agent/files"');
  });

  it("moves built-in tools and MCP servers into agent tabs", () => {
    expect(layoutSource).toContain('to: "/agent/tools"');
    expect(layoutSource).toContain("Built-in Tools");
    expect(layoutSource).toContain('to: "/agent/mcp-servers"');
    expect(layoutSource).toContain("MCP Servers");
    expect(layoutSource).not.toContain("/capabilities");
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
