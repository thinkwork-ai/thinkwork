import { describe, expect, it } from "vitest";
import {
  buildWorkspaceBaseline,
  computeWorkspaceChangedFiles,
} from "../src/workspace-diff.js";

describe("workspace diff", () => {
  it("computes create, modify, and delete changes with base etags", () => {
    const baseline = buildWorkspaceBaseline({
      snapshot: {
        "AGENTS.md": "old",
        "docs/remove.md": "bye",
        ".hydrate_manifest.json": "{}",
      },
      hydrateManifest: {
        files: [
          { path: "AGENTS.md", etag: '"etag-agents"' },
          { path: "docs/remove.md", etag: '"etag-remove"' },
        ],
      },
    });

    expect(
      computeWorkspaceChangedFiles({
        baseline,
        current: {
          "AGENTS.md": "new",
          "docs/new.md": "hello",
          ".hydrate_manifest.json": "{}",
        },
      }),
    ).toEqual([
      {
        path: "AGENTS.md",
        op: "modify",
        content: "new",
        base_etag: '"etag-agents"',
      },
      { path: "docs/new.md", op: "create", content: "hello" },
      { path: "docs/remove.md", op: "delete", base_etag: '"etag-remove"' },
    ]);
  });

  it("returns an empty diff for unchanged snapshots", () => {
    const baseline = buildWorkspaceBaseline({
      snapshot: { "AGENTS.md": "same" },
      hydrateManifest: { files: [{ path: "AGENTS.md", etag: "etag" }] },
    });

    expect(
      computeWorkspaceChangedFiles({
        baseline,
        current: { "AGENTS.md": "same" },
      }),
    ).toEqual([]);
  });
});
