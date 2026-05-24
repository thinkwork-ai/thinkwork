import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildWorkspaceTree,
  installedSkillSlugForNode,
  isSkillInstallFolder,
  subAgentsNodePath,
} from "../FolderTree";

describe("buildWorkspaceTree", () => {
  it("sorts folders before files and preserves nested paths", () => {
    const tree = buildWorkspaceTree([
      "AGENTS.md",
      "expenses/CONTEXT.md",
      "expenses/escalation/GUARDRAILS.md",
    ]);

    // skills/ renders even when empty, so operators have a stable surface
    // to add skills. memory/ is not synthesized because it must be
    // deletable once its backing files are gone.
    expect(tree.map((node) => [node.name, node.path, node.isFolder])).toEqual([
      ["expenses", "expenses", true],
      ["skills", "skills", true],
      ["AGENTS.md", "AGENTS.md", false],
    ]);
    const expensesNode = tree.find((node) => node.path === "expenses");
    expect(expensesNode?.children.map((node) => node.path)).toEqual([
      "expenses/escalation",
      "expenses/CONTEXT.md",
    ]);
    expect(expensesNode?.children[0]?.children[0]?.path).toBe(
      "expenses/escalation/GUARDRAILS.md",
    );
  });

  it("groups routed top-level folders under the synthetic sub-agents node", () => {
    const tree = buildWorkspaceTree(
      [
        "AGENTS.md",
        "attachments/file.pdf",
        "expenses/CONTEXT.md",
        "recruiting/CONTEXT.md",
      ],
      [{ goTo: "expenses/" }, { goTo: "recruiting/" }],
    );

    expect(tree[0]).toMatchObject({
      name: "agents",
      path: subAgentsNodePath(),
      synthetic: true,
    });
    expect(tree[0]?.children.map((node) => node.path)).toEqual([
      "expenses",
      "recruiting",
    ]);
    // skills/ also renders at root. attachments/ remains under root
    // because it has files but isn't a routed sub-agent.
    expect(tree.map((node) => node.path)).toEqual([
      subAgentsNodePath(),
      "attachments",
      "skills",
      "AGENTS.md",
    ]);
  });

  it("renders routed folders with no files as missing sub-agent entries", () => {
    const tree = buildWorkspaceTree(["AGENTS.md"], [{ goTo: "expenses/" }]);

    expect(tree[0]?.children).toEqual([
      {
        name: "expenses",
        path: "expenses",
        isFolder: true,
        children: [],
        missing: true,
      },
    ]);
  });

  it("does not group reserved routing targets", () => {
    const tree = buildWorkspaceTree(
      ["memory/lessons.md", "skills/foo/SKILL.md"],
      [{ goTo: "memory/" }, { goTo: "skills/" }],
    );

    expect(tree.map((node) => node.path)).toEqual(["memory", "skills"]);
  });

  it("enables Add Skill only for real skills folders with install support", () => {
    expect(isSkillInstallFolder({ name: "skills", isFolder: true }, true)).toBe(
      true,
    );
    expect(
      isSkillInstallFolder({ name: "skills", isFolder: false }, true),
    ).toBe(false);
    expect(isSkillInstallFolder({ name: "memory", isFolder: true }, true)).toBe(
      false,
    );
    expect(
      isSkillInstallFolder({ name: "skills", isFolder: true }, false),
    ).toBe(false);
    expect(
      isSkillInstallFolder(
        { name: "skills", isFolder: true, missing: true },
        true,
      ),
    ).toBe(false);
    expect(
      isSkillInstallFolder(
        { name: "skills", isFolder: true, synthetic: true },
        true,
      ),
    ).toBe(false);
  });

  it("detects only catalog-installed skill folders", () => {
    const tree = buildWorkspaceTree([
      "skills/finance-audit-xls/.catalog-ref.json",
      "skills/finance-audit-xls/SKILL.md",
      "skills/draft-tool/SKILL.md",
      "skills/draft-tool/WIRING.md",
    ]);
    const skills = tree.find((node) => node.path === "skills");
    const finance = skills?.children.find(
      (node) => node.path === "skills/finance-audit-xls",
    );
    const draft = skills?.children.find(
      (node) => node.path === "skills/draft-tool",
    );

    expect(finance ? installedSkillSlugForNode(finance) : null).toBe(
      "finance-audit-xls",
    );
    expect(draft ? installedSkillSlugForNode(draft) : null).toBeNull();
    expect(skills ? installedSkillSlugForNode(skills) : null).toBeNull();
  });

  it("contains inline create and rename affordances", () => {
    const source = readFileSync(
      new URL("../FolderTree.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(/onRename/);
    expect(source).toMatch(/Rename/);
    expect(source).toMatch(/Regenerate Map/);
    expect(source).toMatch(/node\.name === "AGENTS\.md"/);
    expect(source).toMatch(/Generate Folder Structure/);
    expect(source).toMatch(/node\.name === "CONTEXT\.md"/);
    expect(source).toMatch(/Add Skill/);
    expect(source).toMatch(/Remove Skill/);
    expect(source).toMatch(/onAddSkill/);
    expect(source).toMatch(/onRemoveSkill/);
    expect(source).toMatch(/installedSkillSlugForNode/);
    expect(source).toMatch(/skillDriftByPath/);
    expect(source).toMatch(/SkillDriftStatus/);
    expect(source).toMatch(/stale/);
    expect(source).toMatch(/orphan/);
    expect(source).toMatch(/TooltipContent/);
    expect(source).toMatch(/onDeleteSyntheticGroup/);
    expect(source).toMatch(/syntheticFolderPaths/);
    expect(source).toMatch(/InlineNameInput/);
    expect(source).toMatch(/PendingInlineFile/);
    expect(source).toMatch(/PendingInlineFolder/);
    expect(source).toMatch(/new-folder/);
    expect(source).toMatch(/onInlineEditCommit/);
    expect(source).toMatch(/input\.select\(\)/);
    expect(source).toMatch(/setSelectionRange/);
  });
});
