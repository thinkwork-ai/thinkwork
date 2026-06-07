import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/components/settings/SettingsTools.tsx"),
  "utf8",
);

describe("SettingsTools built-in tools catalog", () => {
  it("exposes Web Extraction as a Firecrawl credentialed built-in", () => {
    expect(source).toContain('slug: "web-extract"');
    expect(source).toContain('name: "Web Extraction"');
    expect(source).toContain('id: "firecrawl"');
    expect(source).toContain('return "web_extract"');
    expect(source).toContain("agent.webExtract");
  });

  it("keeps the standalone Spaces surface feature-complete", () => {
    expect(source).toContain("PolicyGatedInfoDialog");
    expect(source).toContain("SettingsTenantAgentQuery");
    expect(source).toContain("SettingsTenantSandboxStatusQuery");
    expect(source).toContain("Agent access");
    expect(source).toContain("upsertBuiltinTool");
    expect(source).toContain("testBuiltinTool");
    expect(source).toContain("deleteBuiltinTool");
  });
});
