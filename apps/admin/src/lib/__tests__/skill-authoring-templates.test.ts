import { describe, expect, it } from "vitest";
import {
  buildLocalSkillPath,
  renderSkillExtraFiles,
  renderSkillTemplate,
  slugifySkillName,
} from "../skill-authoring-templates";

describe("skill authoring templates", () => {
  it("slugifies skill names for workspace-safe paths", () => {
    expect(slugifySkillName("Approve Receipt!")).toBe("approve-receipt");
    expect(slugifySkillName("../Approve   Receipt")).toBe("approve-receipt");
  });

  it("builds local skill paths under the reserved skills folder", () => {
    expect(buildLocalSkillPath("Approve Receipt!", "references/guide.md")).toBe(
      "skills/approve-receipt/references/guide.md",
    );
    expect(buildLocalSkillPath("../Approve Receipt!")).toBe(
      "skills/approve-receipt/SKILL.md",
    );
  });

  it("renders knowledge SKILL.md frontmatter with context execution", () => {
    const source = renderSkillTemplate({
      template: "knowledge",
      name: "Approve Receipt",
      description: "Use when approving receipts.",
      category: "finance",
      tags: "receipts, approval",
    });

    expect(source).toMatch(/^name: approve-receipt$/m);
    expect(source).toMatch(/^display_name: "Approve Receipt"$/m);
    expect(source).toMatch(/^execution: context$/m);
    expect(source).toMatch(/^mode: tool$/m);
    expect(source).toMatch(/^category: "finance"$/m);
    expect(source).toMatch(/^  - "receipts"$/m);
    expect(source).toMatch(/^  - "approval"$/m);
  });

  it("renders script SKILL.md and support files with matching script names", () => {
    const options = {
      template: "script-tool" as const,
      name: "Approve Receipt",
      description: "Use when approving receipts.",
      category: "finance",
      tags: "",
    };

    const source = renderSkillTemplate(options);
    const files = renderSkillExtraFiles(options);

    expect(source).toMatch(/^execution: script$/m);
    expect(source).toMatch(/^    path: scripts\/tool.py$/m);
    expect(source).toMatch(/^    default_enabled: true$/m);
    expect(files["scripts/tool.py"]).toContain("def approve_receipt_action");
  });

  it("renders runbook skills with a standard Agent Skill contract", () => {
    const options = {
      template: "runbook" as const,
      name: "Quarterly Business Review",
      description: "Build a quarterly business review artifact.",
      category: "artifact",
      tags: "review",
    };

    const source = renderSkillTemplate(options);
    const files = renderSkillExtraFiles(options);
    const contract = JSON.parse(files["references/thinkwork-runbook.json"]);

    expect(source).toMatch(/^  thinkwork_kind: computer-runbook$/m);
    expect(source).toMatch(
      /^  thinkwork_runbook_contract: references\/thinkwork-runbook\.json$/m,
    );
    expect(source).toMatch(/^  - "computer-runbook"$/m);
    expect(source).toMatch(/^  - "review"$/m);
    expect(source).not.toContain("runbook.yaml");
    expect(Object.keys(files).sort()).toEqual([
      "references/analyze.md",
      "references/discover.md",
      "references/produce.md",
      "references/thinkwork-runbook.json",
      "references/validate.md",
    ]);
    expect(contract.routing.explicitAliases).toContain(
      "quarterly business review",
    );
    expect(
      contract.phases.map((phase: { guidance: string }) => phase.guidance),
    ).toEqual([
      "references/discover.md",
      "references/analyze.md",
      "references/produce.md",
      "references/validate.md",
    ]);
  });
});
