import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectLocalWorkspaceChangedFiles,
  createLocalWorkspaceBaseline,
} from "../src/runtime/workspace-diff.js";

describe("workspace-diff", () => {
  it("maps merged runtime paths back to tuple manifest paths", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-workspace-diff-"));
    await mkdir(path.join(dir, "Spaces", "default", "docs"), {
      recursive: true,
    });
    await mkdir(path.join(dir, "User"), { recursive: true });
    await mkdir(path.join(dir, "memory"), { recursive: true });
    await writeFile(path.join(dir, "AGENTS.md"), "# Agent");
    await writeFile(path.join(dir, "User", "USER.md"), "# User");
    await writeFile(
      path.join(dir, "Spaces", "default", "docs", "brief.md"),
      "# Brief",
    );
    await writeFile(
      path.join(dir, ".hydrate_manifest.json"),
      `${JSON.stringify({
        version: 1,
        files: [
          { path: "AGENTS.md", etag: '"agent"' },
          { path: "User/USER.md", etag: '"user"' },
          { path: "Spaces/default/docs/brief.md", etag: '"space"' },
        ],
      })}\n`,
    );

    const baseline = await createLocalWorkspaceBaseline({ workspaceDir: dir });
    await writeFile(path.join(dir, "AGENTS.md"), "# Agent v2");
    await writeFile(path.join(dir, "User", "USER.md"), "# User v2");
    await writeFile(
      path.join(dir, "Spaces", "default", "docs", "brief.md"),
      "# Brief v2",
    );

    await expect(
      collectLocalWorkspaceChangedFiles({ workspaceDir: dir, baseline }),
    ).resolves.toEqual([
      {
        path: "AGENTS.md",
        op: "modify",
        content: "# Agent v2",
        base_etag: '"agent"',
      },
      {
        path: "Spaces/default/docs/brief.md",
        op: "modify",
        content: "# Brief v2",
        base_etag: '"space"',
      },
      {
        path: "User/USER.md",
        op: "modify",
        content: "# User v2",
        base_etag: '"user"',
      },
    ]);
  });
});
