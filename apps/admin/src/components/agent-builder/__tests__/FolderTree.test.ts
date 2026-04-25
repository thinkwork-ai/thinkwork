import { describe, expect, it } from "vitest";
import { buildWorkspaceTree } from "../FolderTree";

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
    expect(tree[0]?.children.map((node) => node.path)).toEqual([
      "expenses/escalation",
      "expenses/CONTEXT.md",
    ]);
    expect(tree[0]?.children[0]?.children[0]?.path).toBe(
      "expenses/escalation/GUARDRAILS.md",
    );
  });
});
