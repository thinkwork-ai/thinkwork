import { describe, expect, it } from "vitest";
import { buildWorkspaceTree, subAgentsNodePath } from "../FolderTree";

describe("buildWorkspaceTree", () => {
  it("sorts folders before files and preserves nested paths", () => {
    const tree = buildWorkspaceTree([
      "AGENTS.md",
      "expenses/CONTEXT.md",
      "expenses/escalation/GUARDRAILS.md",
    ]);

    expect(tree.map((node) => [node.name, node.path, node.isFolder])).toEqual([
      ["agents", subAgentsNodePath(), true],
      ["expenses", "expenses", true],
      ["AGENTS.md", "AGENTS.md", false],
    ]);
    expect(tree[1]?.children.map((node) => node.path)).toEqual([
      "expenses/escalation",
      "expenses/CONTEXT.md",
    ]);
    expect(tree[1]?.children[0]?.children[0]?.path).toBe(
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
    expect(tree.map((node) => node.path)).toEqual([
      subAgentsNodePath(),
      "attachments",
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

    expect(tree[0]?.children).toEqual([]);
    expect(tree.map((node) => node.path)).toEqual([
      subAgentsNodePath(),
      "memory",
      "skills",
    ]);
  });
});
