import { describe, expect, it } from "vitest";
import {
  type ReconcileContext,
  type ReconcileObjectStore,
  reconcileChangedFiles,
  validateChangedFiles,
} from "./reconcile.js";
import type { WorkspaceHydrateManifest } from "../workspace-renderer/types.js";

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
  const context: ReconcileContext = {
    tenantId: "tenant-1",
    tenantSlug: "acme",
    agentId: "agent-1",
    spaceId: "space-1",
    spaceAccessMode: "public",
    userId: "user-1",
    threadId: "thread-1",
    renderedPrefix: "tenants/acme/threads/thread-1/",
  };
  const hydrateManifest: WorkspaceHydrateManifest = {
    version: 1,
    renderedPrefix: "tenants/acme/threads/thread-1/",
    generatedAt: "2026-05-31T00:00:00.000Z",
    sources: [
      { owner: "agent", prefix: "tenants/acme/agents/marco/" },
      { owner: "space", prefix: "tenants/acme/spaces/board-pack/" },
      { owner: "user", prefix: "tenants/acme/users/eric/" },
    ],
    files: [
      {
        path: "memory/preferences.md",
        owner: "user",
        sourceKey: "tenants/acme/users/eric/memory/preferences.md",
        sourcePrefix: "tenants/acme/users/eric/",
        sourcePath: "memory/preferences.md",
        etag: '"user-old"',
        readOnly: false,
      },
      {
        path: "docs/brief.md",
        owner: "space",
        sourceKey: "tenants/acme/spaces/board-pack/docs/brief.md",
        sourcePrefix: "tenants/acme/spaces/board-pack/",
        sourcePath: "docs/brief.md",
        etag: '"space-old"',
        readOnly: false,
      },
      {
        path: "skills/research/SKILL.md",
        owner: "agent",
        sourceKey: "tenants/acme/agents/marco/skills/research/SKILL.md",
        sourcePrefix: "tenants/acme/agents/marco/",
        sourcePath: "skills/research/SKILL.md",
        etag: '"agent-old"',
        readOnly: false,
      },
    ],
    statusMounts: [],
  };

  function objectStore(): ReconcileObjectStore & {
    puts: Array<{
      key: string;
      content: string;
      ifNoneMatch?: string;
      ifMatch?: string;
    }>;
    deletes: Array<{ key: string; ifMatch: string }>;
  } {
    const puts: Array<{
      key: string;
      content: string;
      ifNoneMatch?: string;
      ifMatch?: string;
    }> = [];
    const deletes: Array<{ key: string; ifMatch: string }> = [];
    return {
      puts,
      deletes,
      async getText() {
        return `${JSON.stringify(hydrateManifest)}\n`;
      },
      async putText(input) {
        puts.push({
          key: input.key,
          content: input.content,
          ifNoneMatch: input.ifNoneMatch,
          ifMatch: input.ifMatch,
        });
        return '"new-etag"';
      },
      async deleteObject(input) {
        deletes.push({ key: input.key, ifMatch: input.ifMatch });
      },
    };
  }

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

  it("routes user, space, and agent writes to canonical source keys", async () => {
    const store = objectStore();

    const result = await reconcileChangedFiles({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      bucket: "workspace-bucket",
      context,
      hydrateManifest,
      objectStore: store,
      changedFiles: [
        {
          path: "memory/preferences.md",
          op: "modify",
          content: "# Prefs\n",
          base_etag: '"user-old"',
        },
        {
          path: "docs/brief.md",
          op: "modify",
          content: "# Brief\n",
          base_etag: '"space-old"',
        },
        {
          path: "skills/research/SKILL.md",
          op: "modify",
          content: "# Skill\n",
          base_etag: '"agent-old"',
        },
      ],
    });

    expect(result.status).toBe("complete");
    expect(store.puts).toEqual([
      {
        key: "tenants/acme/users/eric/memory/preferences.md",
        content: "# Prefs\n",
        ifMatch: '"user-old"',
      },
      {
        key: "tenants/acme/spaces/board-pack/docs/brief.md",
        content: "# Brief\n",
        ifMatch: '"space-old"',
      },
      {
        key: "tenants/acme/agents/marco/skills/research/SKILL.md",
        content: "# Skill\n",
        ifMatch: '"agent-old"',
      },
    ]);
  });

  it("creates with IfNoneMatch and deletes with IfMatch", async () => {
    const store = objectStore();

    const result = await reconcileChangedFiles({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      bucket: "workspace-bucket",
      context,
      hydrateManifest,
      objectStore: store,
      changedFiles: [
        { path: "memory/new.md", op: "create", content: "# New\n" },
        {
          path: "docs/brief.md",
          op: "delete",
          base_etag: '"space-old"',
        },
      ],
    });

    expect(result.status).toBe("complete");
    expect(store.puts).toEqual([
      {
        key: "tenants/acme/users/eric/memory/new.md",
        content: "# New\n",
        ifNoneMatch: "*",
      },
    ]);
    expect(store.deletes).toEqual([
      {
        key: "tenants/acme/spaces/board-pack/docs/brief.md",
        ifMatch: '"space-old"',
      },
    ]);
  });

  it("reports partial failures for ETag conflicts, unmapped paths, scratch, and secrets", async () => {
    const store = objectStore();
    store.putText = async (input) => {
      store.puts.push({
        key: input.key,
        content: input.content,
        ifNoneMatch: input.ifNoneMatch,
        ifMatch: input.ifMatch,
      });
      if (input.key.endsWith("conflict.md")) {
        const error = new Error("conflict") as Error & {
          $metadata: { httpStatusCode: number };
        };
        error.$metadata = { httpStatusCode: 412 };
        throw error;
      }
      return '"new-etag"';
    };

    const result = await reconcileChangedFiles({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      bucket: "workspace-bucket",
      context,
      hydrateManifest,
      objectStore: store,
      changedFiles: [
        { path: "memory/ok.md", op: "create", content: "# OK\n" },
        { path: "memory/conflict.md", op: "create", content: "# Conflict\n" },
        { path: "scratch/tmp.md", op: "create", content: "tmp" },
        { path: "unknown/file.md", op: "create", content: "nope" },
        {
          path: "memory/secret.md",
          op: "create",
          content: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
        },
      ],
    });

    expect(result.status).toBe("partial_success");
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "memory/ok.md", status: "written" }),
        expect.objectContaining({
          path: "memory/conflict.md",
          status: "rejected",
          code: "precondition_failed",
        }),
        expect.objectContaining({
          path: "scratch/tmp.md",
          status: "dropped_scratch",
        }),
        expect.objectContaining({
          path: "unknown/file.md",
          status: "rejected",
          code: "unowned_path",
        }),
        expect.objectContaining({
          path: "memory/secret.md",
          status: "rejected",
          code: "secret_detected",
          rule: "openai_api_key",
        }),
      ]),
    );
  });

  it("rejects modify/delete without matching manifest ETags", async () => {
    const store = objectStore();

    const result = await reconcileChangedFiles({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      bucket: "workspace-bucket",
      context,
      hydrateManifest,
      objectStore: store,
      changedFiles: [
        { path: "memory/preferences.md", op: "modify", content: "# Prefs\n" },
        {
          path: "docs/brief.md",
          op: "delete",
          base_etag: '"stale"',
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.files).toEqual([
      expect.objectContaining({ code: "base_etag_required" }),
      expect.objectContaining({ code: "base_etag_mismatch" }),
    ]);
    expect(store.puts).toEqual([]);
    expect(store.deletes).toEqual([]);
  });

  it("reports an invalid hydrate manifest as per-file failures", async () => {
    const store = objectStore();
    store.getText = async () => "{";

    const result = await reconcileChangedFiles({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      bucket: "workspace-bucket",
      context,
      objectStore: store,
      changedFiles: [
        { path: "memory/new.md", op: "create", content: "# New\n" },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.files).toEqual([
      expect.objectContaining({
        path: "memory/new.md",
        status: "rejected",
        code: "manifest_invalid",
      }),
    ]);
    expect(store.puts).toEqual([]);
  });
});
