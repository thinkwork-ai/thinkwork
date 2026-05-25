import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildWorkspaceTree,
  folderContextMenuTargets,
  installedSkillSlugForNode,
  isSkillInstallFolder,
} from "../FolderTree";

describe("buildWorkspaceTree", () => {
  it("sorts folders before files and preserves nested paths", () => {
    const tree = buildWorkspaceTree([
      "AGENTS.md",
      "expenses/CONTEXT.md",
      "expenses/escalation/GUARDRAILS.md",
    ]);

    expect(tree.map((node) => [node.name, node.path, node.isFolder])).toEqual([
      ["expenses", "expenses", true],
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

  it("renders workspaces-parent subagents as a real top-level folder", () => {
    const tree = buildWorkspaceTree([
      "AGENTS.md",
      "attachments/file.pdf",
      "workspaces/sql/CONTEXT.md",
      "workspaces/finance-analyst/CONTEXT.md",
    ]);

    expect(tree.map((node) => node.path)).toEqual([
      "attachments",
      "workspaces",
      "AGENTS.md",
    ]);
    const workspaces = tree.find((node) => node.path === "workspaces");
    expect(workspaces?.children.map((node) => node.path)).toEqual([
      "workspaces/finance-analyst",
      "workspaces/sql",
    ]);
  });

  it("targets the real workspaces folder for normal folder context-menu actions", () => {
    const tree = buildWorkspaceTree(["AGENTS.md", "workspaces/sql/CONTEXT.md"]);
    const workspaces = tree.find((node) => node.path === "workspaces");

    expect(workspaces).toBeDefined();
    expect(folderContextMenuTargets(workspaces!)).toEqual({
      createParentPath: "workspaces",
      pasteTargetPath: "workspaces",
      renamePath: "workspaces",
      cutPath: "workspaces",
      deletePath: "workspaces",
    });
  });

  it("renders legacy flat-storage subagents at their actual flat paths", () => {
    const tree = buildWorkspaceTree([
      "AGENTS.md",
      "expenses/CONTEXT.md",
      "recruiting/CONTEXT.md",
    ]);

    expect(tree.map((node) => node.path)).toEqual([
      "expenses",
      "recruiting",
      "AGENTS.md",
    ]);
  });

  it("renders real root folders as normal tree folders", () => {
    const tree = buildWorkspaceTree([
      "memory/lessons.md",
      "skills/foo/SKILL.md",
    ]);

    expect(tree.map((node) => node.path)).toEqual(["memory", "skills"]);
  });

  it("enables Add Skill only for real skills folders with install support", () => {
    expect(
      isSkillInstallFolder(
        { name: "skills", path: "skills", isFolder: true },
        true,
      ),
    ).toBe(true);
    expect(
      isSkillInstallFolder(
        { name: "skills", path: "skills", isFolder: false },
        true,
      ),
    ).toBe(false);
    expect(
      isSkillInstallFolder(
        { name: "memory", path: "memory", isFolder: true },
        true,
      ),
    ).toBe(false);
    expect(
      isSkillInstallFolder(
        { name: "skills", path: "skills", isFolder: true },
        false,
      ),
    ).toBe(false);
    expect(
      isSkillInstallFolder(
        { name: "skills", path: "workspaces/sql/skills", isFolder: true },
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
    expect(source).toMatch(/onReinstallSkill/);
    expect(source).toMatch(/Reinstall Skill/);
    expect(source).toMatch(/installedSkillSlugForNode/);
    expect(source).toMatch(/skillDriftByPath/);
    expect(source).toMatch(/SkillDriftStatus/);
    expect(source).toMatch(/stale/);
    expect(source).toMatch(/orphan/);
    expect(source).toMatch(/TooltipContent/);
    expect(source).not.toMatch(/onDeleteSyntheticGroup/);
    expect(source).not.toMatch(/syntheticFolderPaths/);
    expect(source).not.toMatch(/__synthetic__\/sub-agents/);
    expect(source).toMatch(/InlineNameInput/);
    expect(source).toMatch(/PendingInlineFile/);
    expect(source).toMatch(/PendingInlineFolder/);
    expect(source).toMatch(/new-folder/);
    expect(source).toMatch(/onInlineEditCommit/);
    expect(source).toMatch(/input\.select\(\)/);
    expect(source).toMatch(/setSelectionRange/);
  });
});
