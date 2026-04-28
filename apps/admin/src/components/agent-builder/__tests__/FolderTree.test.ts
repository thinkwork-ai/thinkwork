import { describe, expect, it } from "vitest";
import { buildWorkspaceTree, subAgentsNodePath } from "../FolderTree";

describe("buildWorkspaceTree", () => {
  it("sorts folders before files and preserves nested paths", () => {
    const tree = buildWorkspaceTree([
      "AGENTS.md",
      "expenses/CONTEXT.md",
      "expenses/escalation/GUARDRAILS.md",
    ]);

    // Per docs/plans/2026-04-27-004 U2: reserved root folders memory/
    // and skills/ render even when no files exist under them, so
    // operators have a stable surface to add things to.
    expect(tree.map((node) => [node.name, node.path, node.isFolder])).toEqual([
      ["expenses", "expenses", true],
      ["memory", "memory", true],
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
    // Reserved root folders memory/ and skills/ also render at root
    // (per U2/U8). attachments/ remains under root because it has
    // files but isn't a routed sub-agent.
    expect(tree.map((node) => node.path)).toEqual([
      subAgentsNodePath(),
      "attachments",
      "memory",
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
});
