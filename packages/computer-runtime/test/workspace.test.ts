import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ensureWorkspace, writeHealthCheck } from "../src/workspace.js";

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
});
