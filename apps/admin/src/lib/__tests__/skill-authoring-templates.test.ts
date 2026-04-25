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
    expect(
      buildLocalSkillPath("Approve Receipt!", "references/guide.md"),
    ).toBe("skills/approve-receipt/references/guide.md");
    expect(buildLocalSkillPath("../Approve Receipt!")).toBe("skills/approve-receipt/SKILL.md");
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
});
