import { describe, expect, it } from "vitest";

import { parseToolsMdPolicy } from "./tools-md-parser.js";

describe("parseToolsMdPolicy", () => {
  it("parses model routing from YAML frontmatter", () => {
    const parsed = parseToolsMdPolicy(
      `---
modelRouting:
  - tool: workspace_skill
    match:
      slug: financial-analysis
    model: us.anthropic.claude-haiku-4-5-20251001-v1:0
    reason: Cheaper analyst pass
---
# Tools
`,
      { path: "TOOLS.md" },
    );

    expect(parsed.frontmatterPresent).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.modelRouting).toEqual([
      {
        tool: "workspace_skill",
        match: { slug: "financial-analysis" },
        model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        reason: "Cheaper analyst pass",
      },
    ]);
  });

  it("treats prose-only TOOLS.md as an empty policy", () => {
    const parsed = parseToolsMdPolicy("# Tools\n\nUse search when needed.\n");

    expect(parsed.frontmatterPresent).toBe(false);
    expect(parsed.modelRouting).toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
  });

  it("diagnoses malformed frontmatter and invalid routes", () => {
    const parsed = parseToolsMdPolicy(
      `---
modelRouting:
  - tool: workspace_skill
    match: []
  - tool: 42
    model: ""
---
# Tools
`,
      { path: "User/TOOLS.md" },
    );

    expect(parsed.modelRouting).toEqual([]);
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "ToolsMdInvalidModelRouteMatch",
      "ToolsMdInvalidModelRoute",
      "ToolsMdInvalidModelRoute",
    ]);
  });
});
