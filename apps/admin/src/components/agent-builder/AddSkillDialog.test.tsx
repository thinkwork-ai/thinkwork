import { describe, expect, it } from "vitest";
import {
  catalogSkillSlugs,
  parseClientWiringMd,
  skillSummary,
  slugifyWiringTitle,
  summarizeCatalogSkills,
} from "./AddSkillDialog";

describe("AddSkillDialog helpers", () => {
  it("discovers catalog skills from SKILL.md paths only", () => {
    expect(
      catalogSkillSlugs([
        "finance-audit-xls/SKILL.md",
        "finance-audit-xls/WIRING.md",
        "sales-prep/README.md",
        "sales-prep/SKILL.md",
      ]),
    ).toEqual(["finance-audit-xls", "sales-prep"]);
  });

  it("summarizes skills from frontmatter or the first non-heading paragraph", () => {
    expect(
      skillSummary(`---
summary: "Audit Excel workbooks"
---
# Finance Audit
Body
`),
    ).toBe("Audit Excel workbooks");
    expect(
      summarizeCatalogSkills([
        {
          slug: "sales-prep",
          skillMd: "# Sales Prep\nPrepare a customer brief.\n",
        },
      ]),
    ).toEqual([{ slug: "sales-prep", summary: "Prepare a customer brief." }]);
  });

  it("parses client-side WIRING.md suggestions", () => {
    const options = parseClientWiringMd(`# Wiring suggestions

## Stage 3 Gate
Use this before final review.

\`\`\`context-md
| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |
\`\`\`

## Always On

\`\`\`context-md
| Always on | . | skills/finance-audit-xls/SKILL.md |
\`\`\`
`);

    expect(options).toEqual([
      {
        id: "stage-3-gate",
        title: "Stage 3 Gate",
        description: "Use this before final review.",
        snippet: "| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |\n",
      },
      {
        id: "always-on",
        title: "Always On",
        description: "",
        snippet: "| Always on | . | skills/finance-audit-xls/SKILL.md |\n",
      },
    ]);
  });

  it("ignores wiring sections without context-md snippets", () => {
    expect(parseClientWiringMd("## Notes\nNo snippet here.\n")).toEqual([]);
  });

  it("uses the same slug shape as the backend parser", () => {
    expect(slugifyWiringTitle(" Stage 3: Gate! ")).toBe("stage-3-gate");
  });
});
