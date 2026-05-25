import { describe, expect, it } from "vitest";
import { parseMentionableWorkspaces } from "./space-md-parser.js";

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
