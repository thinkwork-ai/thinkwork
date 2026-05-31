import { describe, expect, it } from "vitest";
import {
  ReconcileNotImplementedError,
  reconcileChangedFiles,
  validateChangedFiles,
} from "./reconcile.js";

describe("validateChangedFiles", () => {
  it("accepts create, modify, and delete changed-file payloads", () => {
    expect(
      validateChangedFiles([
        { path: "docs/new.md", op: "create", content: "# New\n" },
        {
          path: "memory/prefs.md",
          op: "modify",
          content: "# Prefs\n",
          base_etag: '"old"',
        },
        { path: "scratch/tmp.md", op: "delete", base_etag: '"tmp"' },
      ]),
    ).toEqual({
      ok: true,
      changedFiles: [
        { path: "docs/new.md", op: "create", content: "# New\n" },
        {
          path: "memory/prefs.md",
          op: "modify",
          content: "# Prefs\n",
          base_etag: '"old"',
        },
        { path: "scratch/tmp.md", op: "delete", base_etag: '"tmp"' },
      ],
    });
  });

  it("rejects missing content for create/modify and content on delete", () => {
    const result = validateChangedFiles([
      { path: "docs/new.md", op: "create" },
      { path: "docs/old.md", op: "modify" },
      { path: "docs/deleted.md", op: "delete", content: "nope" },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toEqual([
        "content_required",
        "content_required",
        "content_forbidden",
      ]);
    }
  });

  it("rejects malformed paths, unsupported ops, and oversized payloads", () => {
    const result = validateChangedFiles([
      { path: "../secrets.md", op: "modify", content: "x" },
      { path: "/absolute.md", op: "modify", content: "x" },
      { path: "nested//empty.md", op: "modify", content: "x" },
      { path: "docs/file.md", op: "rename", content: "x" },
      { path: "docs/huge.md", op: "modify", content: "x".repeat(262145) },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toEqual(
        expect.arrayContaining([
          "invalid_path",
          "invalid_op",
          "content_too_large",
        ]),
      );
    }
  });
});

describe("reconcileChangedFiles", () => {
  it("is a clean no-op for an empty diff", async () => {
    await expect(
      reconcileChangedFiles({
        tenantId: "tenant-1",
        agentId: "agent-1",
        threadId: "thread-1",
        threadTurnId: "turn-1",
        changedFiles: [],
      }),
    ).resolves.toEqual({ status: "no_changes", files: [] });
  });

  it("throws the U4 stub error for non-empty diffs", async () => {
    await expect(
      reconcileChangedFiles({
        tenantId: "tenant-1",
        agentId: "agent-1",
        threadId: "thread-1",
        threadTurnId: "turn-1",
        changedFiles: [
          { path: "docs/new.md", op: "create", content: "# New\n" },
        ],
      }),
    ).rejects.toBeInstanceOf(ReconcileNotImplementedError);
  });
});
