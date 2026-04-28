import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("capabilities layout", () => {
  const layoutSource = readSource("../../capabilities.tsx");
  const indexSource = readSource("../index.tsx");

  it("defaults capabilities to built-in tools", () => {
    expect(indexSource).toContain('to: "/capabilities/builtin-tools"');
  });

  it("puts built-in tools first and hides unsupported plugins", () => {
    const builtinIndex = layoutSource.indexOf('value="builtin-tools"');
    const skillsIndex = layoutSource.indexOf('value="skills"');
    const mcpIndex = layoutSource.indexOf('value="mcp-servers"');

    expect(builtinIndex).toBeGreaterThanOrEqual(0);
    expect(skillsIndex).toBeGreaterThan(builtinIndex);
    expect(mcpIndex).toBeGreaterThan(skillsIndex);
    expect(layoutSource).not.toContain('value="plugins"');
    expect(layoutSource).not.toContain('to="/capabilities/plugins"');
  });
});
