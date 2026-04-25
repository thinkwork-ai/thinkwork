import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLocalSkillPath,
  renderSkillExtraFiles,
  renderSkillTemplate,
  slugifySkillName,
} from "../skill-authoring-templates";

describe("skill authoring templates", () => {
  it("slugifies skill names for workspace-safe paths", () => {
    assert.equal(slugifySkillName("Approve Receipt!"), "approve-receipt");
    assert.equal(slugifySkillName("../Approve   Receipt"), "approve-receipt");
  });

  it("builds local skill paths under the reserved skills folder", () => {
    assert.equal(
      buildLocalSkillPath("Approve Receipt!", "references/guide.md"),
      "skills/approve-receipt/references/guide.md",
    );
    assert.equal(buildLocalSkillPath("../Approve Receipt!"), "skills/approve-receipt/SKILL.md");
  });

  it("renders knowledge SKILL.md frontmatter with context execution", () => {
    const source = renderSkillTemplate({
      template: "knowledge",
      name: "Approve Receipt",
      description: "Use when approving receipts.",
      category: "finance",
      tags: "receipts, approval",
    });

    assert.match(source, /^name: approve-receipt$/m);
    assert.match(source, /^display_name: "Approve Receipt"$/m);
    assert.match(source, /^execution: context$/m);
    assert.match(source, /^mode: tool$/m);
    assert.match(source, /^category: "finance"$/m);
    assert.match(source, /^  - "receipts"$/m);
    assert.match(source, /^  - "approval"$/m);
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

    assert.match(source, /^execution: script$/m);
    assert.match(source, /^    path: scripts\/tool.py$/m);
    assert.match(source, /^    default_enabled: true$/m);
    assert.ok(files["scripts/tool.py"]?.includes("def approve_receipt_action"));
  });
});
