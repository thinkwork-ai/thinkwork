import { describe, expect, it } from "vitest";
import { buildWorkspaceTree } from "../components/FolderTree.js";

describe("buildWorkspaceTree", () => {
  it("hides folder sentinel files and keeps real markdown files", () => {
    const tree = buildWorkspaceTree([
      "GOAL.md",
      "artifacts/.gitkeep",
      "handoffs/HANDOFFS.md",
    ]);

    expect(tree).toMatchObject([
      {
        name: "artifacts",
        path: "artifacts",
        isFolder: true,
        children: [],
      },
      {
        name: "handoffs",
        path: "handoffs",
        isFolder: true,
        children: [
          {
            name: "HANDOFFS.md",
            path: "handoffs/HANDOFFS.md",
            isFolder: false,
          },
        ],
      },
      {
        name: "GOAL.md",
        path: "GOAL.md",
        isFolder: false,
      },
    ]);
  });
});
