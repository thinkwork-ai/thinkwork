import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendFetchedFilesToWorkspaceBaseline,
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

// Plan 2026-06-12-002 U5 — fetched read-only mounts must not pollute the
// turn diff (AE1's "zero changed files for fetched paths" half).
describe("appendFetchedFilesToWorkspaceBaseline", () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it("fetched files mounted mid-turn produce zero changed files; agent edits still diff", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-workspace-fetch-"));
    await writeFile(path.join(dir, "AGENTS.md"), "# Agent");
    const baseline = await createLocalWorkspaceBaseline({ workspaceDir: dir });

    // Simulate the fetch tool: mount Space B read-only AFTER the baseline
    // was created, then append the fetched contents to the baseline.
    const mountDir = path.join(dir, "Spaces", "research-b");
    await mkdir(path.join(mountDir, "docs"), { recursive: true });
    await writeFile(path.join(mountDir, "NOTES.md"), "# B notes");
    await writeFile(path.join(mountDir, "docs", "PLAN.md"), "plan body");
    await chmod(path.join(mountDir, "NOTES.md"), 0o444);
    await chmod(path.join(mountDir, "docs", "PLAN.md"), 0o444);
    const appendedCount = appendFetchedFilesToWorkspaceBaseline(baseline, [
      { path: "Spaces/research-b/NOTES.md", bytes: encode("# B notes") },
      {
        path: "Spaces/research-b/docs/PLAN.md",
        bytes: encode("plan body"),
        etag: '"fetched"',
      },
    ]);
    expect(appendedCount).toBe(2);

    // Fetched paths: no phantom creates. Untouched workspace: no changes.
    await expect(
      collectLocalWorkspaceChangedFiles({ workspaceDir: dir, baseline }),
    ).resolves.toEqual([]);

    // A real agent edit elsewhere still diffs normally.
    await writeFile(path.join(dir, "AGENTS.md"), "# Agent v2");
    await expect(
      collectLocalWorkspaceChangedFiles({ workspaceDir: dir, baseline }),
    ).resolves.toEqual([
      { path: "AGENTS.md", op: "modify", content: "# Agent v2" },
    ]);
  });

  it("skips oversized and binary files exactly like the snapshot reader (no phantom deletes)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-workspace-fetch-"));
    const baseline = await createLocalWorkspaceBaseline({ workspaceDir: dir });

    const mountDir = path.join(dir, "Spaces", "research-b");
    await mkdir(mountDir, { recursive: true });
    const binary = new Uint8Array([0x89, 0x50, 0x00, 0x47]); // contains NUL
    const oversized = new Uint8Array(256 * 1024 + 1).fill(0x61);
    await writeFile(path.join(mountDir, "image.png"), binary);
    await writeFile(path.join(mountDir, "huge.txt"), oversized);
    await writeFile(path.join(mountDir, "ok.md"), "fine");

    const appendedCount = appendFetchedFilesToWorkspaceBaseline(baseline, [
      { path: "Spaces/research-b/image.png", bytes: binary },
      { path: "Spaces/research-b/huge.txt", bytes: oversized },
      { path: "Spaces/research-b/ok.md", bytes: encode("fine") },
      { path: "../escape.md", bytes: encode("nope") },
    ]);
    // Only ok.md lands; the snapshot reader skips the same binary/oversized
    // files, so neither side sees them → still a zero diff.
    expect(appendedCount).toBe(1);
    await expect(
      collectLocalWorkspaceChangedFiles({ workspaceDir: dir, baseline }),
    ).resolves.toEqual([]);
  });

  it("re-appending the same path overwrites in place (idempotent re-fetch)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-workspace-fetch-"));
    const baseline = await createLocalWorkspaceBaseline({ workspaceDir: dir });

    appendFetchedFilesToWorkspaceBaseline(baseline, [
      { path: "Spaces/b/a.md", bytes: encode("v1") },
    ]);
    appendFetchedFilesToWorkspaceBaseline(baseline, [
      { path: "Spaces/b/a.md", bytes: encode("v2") },
    ]);
    expect(Object.keys(baseline)).toEqual(["Spaces/b/a.md"]);
    expect(baseline["Spaces/b/a.md"]!.content).toBe("v2");

    const mountDir = path.join(dir, "Spaces", "b");
    await mkdir(mountDir, { recursive: true });
    await writeFile(path.join(mountDir, "a.md"), "v2");
    await expect(
      collectLocalWorkspaceChangedFiles({ workspaceDir: dir, baseline }),
    ).resolves.toEqual([]);
  });
});
