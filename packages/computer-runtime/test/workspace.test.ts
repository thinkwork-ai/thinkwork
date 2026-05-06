import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  ensureWorkspace,
  validateWorkspaceRelativePath,
  writeHealthCheck,
  writeWorkspaceFile,
} from "../src/workspace.js";

describe("Computer runtime workspace", () => {
  it("creates a writable health marker in the workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-computer-"));
    const marker = await ensureWorkspace(root);
    await expect(readFile(marker, "utf8")).resolves.toContain("ok");
  });

  it("writes task-specific health-check markers", async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-computer-"));
    const marker = await writeHealthCheck(root, "task-1");
    await expect(readFile(marker, "utf8")).resolves.toContain("task-1");
  });

  it("writes nested workspace files", async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-computer-"));
    const result = await writeWorkspaceFile(root, {
      path: "drafts/today.md",
      content: "# Today\n",
    });

    expect(result).toMatchObject({
      relativePath: "drafts/today.md",
      bytes: 8,
    });
    await expect(readFile(join(root, "drafts/today.md"), "utf8")).resolves.toBe(
      "# Today\n",
    );
  });

  it("normalizes safe relative paths", () => {
    expect(validateWorkspaceRelativePath("notes\\phase3.txt")).toBe(
      "notes/phase3.txt",
    );
  });

  it("rejects absolute and traversal paths", () => {
    expect(() => validateWorkspaceRelativePath("/tmp/out")).toThrow(
      "Workspace path must be relative",
    );
    expect(() => validateWorkspaceRelativePath("notes/../out")).toThrow(
      "Workspace path cannot contain",
    );
  });

  it("rejects oversized workspace file content", async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-computer-"));
    await expect(
      writeWorkspaceFile(root, {
        path: "large.txt",
        content: "x".repeat(256 * 1024 + 1),
      }),
    ).rejects.toThrow("bytes or less");
  });
});
