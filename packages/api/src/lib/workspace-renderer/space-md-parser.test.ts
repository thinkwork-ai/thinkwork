import { describe, expect, it } from "vitest";
import {
  buildSpaceManifestProjection,
  parseMentionableWorkspaces,
  parseSpaceManifest,
} from "./space-md-parser.js";

describe("parseMentionableWorkspaces", () => {
  it("allows all workspaces when the section is absent", () => {
    expect(parseMentionableWorkspaces("# Finance\n\nRegular context.")).toEqual(
      { mode: "all", slugs: [] },
    );
  });

  it("denies all workspaces when the section has an empty fenced block", () => {
    expect(
      parseMentionableWorkspaces(`# Finance

## Mentionable Workspaces

\`\`\`

\`\`\`
`),
    ).toEqual({ mode: "none", slugs: [] });
  });

  it("parses and normalizes the allowlist from the fenced block", () => {
    expect(
      parseMentionableWorkspaces(`# Finance

## Mentionable Workspaces

\`\`\`text
 SQL

finance analyst
sql
\`\`\`

## Another Section
Ignored
`),
    ).toEqual({ mode: "allowlist", slugs: ["finance-analyst", "sql"] });
  });

  it("fails closed when the section is present without a fenced block", () => {
    expect(
      parseMentionableWorkspaces(`# Finance

## Mentionable Workspaces

sql
`),
    ).toEqual({ mode: "none", slugs: [] });
  });
});

describe("parseSpaceManifest", () => {
  it("parses workflows, tools, skills, review policy, and diagnostics", () => {
    const result = parseSpaceManifest(`---
name: Customer Onboarding
description: Coordinates enterprise onboarding work.
workflows:
  - key: kickoff
    name: Kickoff
    description: Prepare the launch sequence.
tools:
  built_in:
    - web-search
  mcp:
    - slack
skills:
  - finance-audit-xls
runtime:
  bash: restricted
  model: anthropic.claude-sonnet-4-5-20250929-v1:0
review_policy:
  mode: required
---
# Customer Onboarding

## Workflows

- Renewal readiness - Build the renewal packet.

## Mentionable Workspaces

\`\`\`
Finance
\`\`\`
`);

    expect(result.title).toBe("Customer Onboarding");
    expect(result.description).toBe("Coordinates enterprise onboarding work.");
    expect(result.workflows).toEqual([
      {
        key: "kickoff",
        name: "Kickoff",
        description: "Prepare the launch sequence.",
        source: "frontmatter",
      },
      {
        key: "renewal-readiness",
        name: "Renewal readiness",
        description: "Build the renewal packet.",
        source: "markdown",
      },
    ]);
    expect(result.tools).toEqual({
      builtIn: ["web-search"],
      mcp: ["slack"],
    });
    expect(result.skills).toEqual(["finance-audit-xls"]);
    expect(result.runtimePolicy).toEqual({
      bash: "restricted",
      model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
      sandbox: null,
    });
    expect(result.reviewPolicy).toEqual({ mode: "required", notes: null });
    expect(result.mentionableWorkspaces).toEqual({
      mode: "allowlist",
      slugs: ["finance"],
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SpaceManifestPendingApply",
          path: "tools",
        }),
        expect.objectContaining({
          code: "SpaceManifestPendingApply",
          path: "runtime",
        }),
        expect.objectContaining({
          code: "SpaceManifestPendingApply",
          path: "review_policy",
        }),
      ]),
    );
  });

  it("reports invalid behavior fields without silently applying them", () => {
    const projection = buildSpaceManifestProjection(`---
name: Support
runtime:
  bash: teleport
---
# Support
`);

    expect(projection.autoApply).toEqual({ name: "Support" });
    expect(projection.manifest.runtimePolicy.bash).toBe("default");
    expect(projection.renderDiagnostics.spaceManifest.status).toBe("warning");
    expect(projection.renderDiagnostics.spaceManifest.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SpaceManifestUnknownBashPolicy",
          path: "runtime.bash",
        }),
      ]),
    );
  });

  it("does not apply descriptive fields when frontmatter is malformed", () => {
    const projection = buildSpaceManifestProjection(`---
name: [unterminated
---
# Fallback
`);

    expect(projection.autoApply).toEqual({});
    expect(projection.renderDiagnostics.spaceManifest.status).toBe("error");
    expect(projection.manifest.diagnostics[0]).toEqual(
      expect.objectContaining({
        code: "SpaceManifestMalformedFrontmatter",
      }),
    );
  });

  it("does not auto-apply title text when descriptive frontmatter is absent", () => {
    const projection = buildSpaceManifestProjection(`# Support

General support operating context.
`);

    expect(projection.manifest.title).toBe("Support");
    expect(projection.manifest.description).toBe(
      "General support operating context.",
    );
    expect(projection.autoApply).toEqual({});
  });

  it("builds projection metadata for settings overview panels", () => {
    const projection = buildSpaceManifestProjection(`---
name: Customer
description: Active customer operating room.
workflows: [handoff]
tools:
  builtIn: [web-search]
skills: [salesforce-research]
---
# Customer
`);

    expect(projection.autoApply).toEqual({
      name: "Customer",
      description: "Active customer operating room.",
    });
    expect(projection.configPatch.spaceManifest.diagnosticCounts).toEqual({
      error: 0,
      info: 0,
      warning: 1,
    });
    expect(projection.renderDiagnostics.spaceManifest).toEqual(
      expect.objectContaining({
        workflowCount: 1,
        builtInToolCount: 1,
        skillCount: 1,
      }),
    );
  });
});
