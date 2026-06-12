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
      { owner: "thread_goal", prefix: "tenants/acme/threads/thread-1/" },
      { owner: "thread_notes", prefix: "tenants/acme/threads/thread-1/" },
    ],
    files: [
      {
        path: "AGENTS.md",
        owner: "agent",
        sourceKey: "tenants/acme/threads/thread-1/AGENTS.md",
        sourcePrefix: "tenants/acme/threads/thread-1/",
        sourcePath: "AGENTS.md",
        etag: '"agents-generated"',
        readOnly: true,
        generated: true,
      },
      {
        path: "User/memory/preferences.md",
        owner: "user",
        sourceKey: "tenants/acme/users/eric/memory/preferences.md",
        sourcePrefix: "tenants/acme/users/eric/",
        sourcePath: "memory/preferences.md",
        etag: '"user-old"',
        readOnly: false,
      },
      {
        path: "User/memory/digest.md",
        owner: "user",
        sourceKey: "tenants/acme/users/eric/memory/digest.md",
        sourcePrefix: "tenants/acme/users/eric/",
        sourcePath: "memory/digest.md",
        etag: '"digest-generated"',
        readOnly: false,
        generated: true,
      },
      {
        path: "Spaces/board-pack/docs/brief.md",
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
      {
        path: "Thread/DECISIONS.md",
        owner: "thread_goal",
        sourceKey: "tenants/acme/threads/thread-1/DECISIONS.md",
        sourcePrefix: "tenants/acme/threads/thread-1/",
        sourcePath: "DECISIONS.md",
        etag: '"decisions-old"',
        readOnly: false,
      },
      {
        path: "Thread/notes/findings.md",
        owner: "thread_notes",
        sourceKey: "tenants/acme/threads/thread-1/notes/findings.md",
        sourcePrefix: "tenants/acme/threads/thread-1/",
        sourcePath: "notes/findings.md",
        etag: '"thread-notes-old"',
        readOnly: false,
      },
    ],
    statusMounts: [
      {
        path: "Thread/GOAL.md",
        owner: "system",
        source: "database",
        provider: "thread-goals",
        readOnly: true,
        available: true,
        sourceKey: "tenants/acme/threads/thread-1/GOAL.md",
        etag: '"goal-db"',
      },
      {
        path: "Thread/PROGRESS.md",
        owner: "system",
        source: "database",
        provider: "thread-goals",
        readOnly: true,
        available: true,
        sourceKey: "tenants/acme/threads/thread-1/PROGRESS.md",
        etag: '"progress-db"',
      },
    ],
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
        const put: {
          key: string;
          content: string;
          ifNoneMatch?: string;
          ifMatch?: string;
        } = {
          key: input.key,
          content: input.content,
        };
        if (input.ifNoneMatch !== undefined)
          put.ifNoneMatch = input.ifNoneMatch;
        if (input.ifMatch !== undefined) put.ifMatch = input.ifMatch;
        puts.push(put);
        return '"new-etag"';
      },
      async deleteObject(input) {
        deletes.push({ key: input.key, ifMatch: input.ifMatch });
      },
    };
  }

  function quarantineStore(): {
    writes: Array<{
      bucket: string;
      key: string;
      content: string;
      kmsKeyId?: string;
      metadata: Record<string, string>;
      expiresAt: Date;
    }>;
    store: {
      put(input: {
        bucket: string;
        key: string;
        content: string;
        kmsKeyId?: string;
        metadata: Record<string, string>;
        expiresAt: Date;
      }): Promise<{ key: string }>;
    };
  } {
    const writes: Array<{
      bucket: string;
      key: string;
      content: string;
      kmsKeyId?: string;
      metadata: Record<string, string>;
      expiresAt: Date;
    }> = [];
    return {
      writes,
      store: {
        async put(input) {
          writes.push(input);
          return { key: input.key };
        },
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

  it("routes agent, space, user, and Thread notes writes to canonical source keys", async () => {
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
          path: "User/memory/preferences.md",
          op: "modify",
          content: "# Prefs\n",
          base_etag: '"user-old"',
        },
        {
          path: "Spaces/board-pack/docs/brief.md",
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
        {
          path: "Thread/notes/findings.md",
          op: "modify",
          content: "# Findings\n",
          base_etag: '"thread-notes-old"',
        },
        {
          path: "Thread/notes/new.md",
          op: "create",
          content: "# New note\n",
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
      {
        key: "tenants/acme/threads/thread-1/notes/findings.md",
        content: "# Findings\n",
        ifMatch: '"thread-notes-old"',
      },
      {
        key: "tenants/acme/threads/thread-1/notes/new.md",
        content: "# New note\n",
        ifNoneMatch: "*",
      },
    ]);
  });

  it("rejects DB-rendered status file writes before source reconciliation", async () => {
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
          path: "GOAL.md",
          op: "modify",
          content: "# Edited goal\n",
          base_etag: '"goal-db"',
        },
        {
          path: "Thread/PROGRESS.md",
          op: "modify",
          content: "# Edited progress\n",
          base_etag: '"progress-db"',
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.files).toEqual([
      expect.objectContaining({
        path: "GOAL.md",
        owner: "status",
        status: "rejected",
        code: "read_only_status_file",
      }),
      expect.objectContaining({
        path: "Thread/PROGRESS.md",
        owner: "status",
        status: "rejected",
        code: "read_only_status_file",
      }),
    ]);
    expect(store.puts).toEqual([]);
    expect(store.deletes).toEqual([]);
  });

  it("rejects writes to the generated AGENTS.md with a settings-baseline pointer", async () => {
    // Plan 2026-06-12-002 U3: the manifest readOnly/generated flags are the
    // trust boundary for render-time composed files; an agent self-edit of
    // AGENTS.md is rejected first-class with a pointer at the operator
    // baseline surface.
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
          path: "AGENTS.md",
          op: "modify",
          content: "# Edited routing\n",
          base_etag: '"agents-generated"',
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.files).toEqual([
      expect.objectContaining({
        path: "AGENTS.md",
        owner: "agent",
        status: "rejected",
        code: "read_only_generated_file",
        message:
          "AGENTS.md is composed at render time; edit the agent baseline in Settings → Main Agent.",
      }),
    ]);
    expect(store.puts).toEqual([]);
  });

  it("honors the manifest generated flag for any generated file", async () => {
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
          path: "User/memory/digest.md",
          op: "modify",
          content: "# Edited digest\n",
          base_etag: '"digest-generated"',
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.files).toEqual([
      expect.objectContaining({
        path: "User/memory/digest.md",
        owner: "user",
        status: "rejected",
        code: "read_only_generated_file",
        message:
          "This file is generated at render time and is read-only. Edit its source surface instead.",
      }),
    ]);
    expect(store.puts).toEqual([]);
  });

  it("rejects modify and delete under a non-active Space folder as fetched read-only context", async () => {
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
          path: "Spaces/other-team/docs/brief.md",
          op: "modify",
          content: "# Edited foreign brief\n",
          base_etag: '"foreign-old"',
        },
        {
          path: "Spaces/other-team/docs/stale.md",
          op: "delete",
          base_etag: '"foreign-stale"',
        },
        {
          path: "User/memory/new.md",
          op: "create",
          content: "# New\n",
        },
      ],
    });

    // Covers AE2: foreign-Space writes appear as per-file rejections in the
    // partial-success report instead of silently misrouting or being lost.
    expect(result.status).toBe("partial_success");
    expect(result.files).toEqual([
      expect.objectContaining({
        path: "Spaces/other-team/docs/brief.md",
        owner: "space",
        status: "rejected",
        code: "fetched_path_read_only",
        message:
          "Content fetched from another Space is read-only context. Writes must target the active Space folder.",
      }),
      expect.objectContaining({
        path: "Spaces/other-team/docs/stale.md",
        owner: "space",
        status: "rejected",
        code: "fetched_path_read_only",
      }),
      expect.objectContaining({
        path: "User/memory/new.md",
        status: "written",
      }),
    ]);
    expect(store.deletes).toEqual([]);
    expect(store.puts.map((put) => put.key)).toEqual([
      "tenants/acme/users/eric/memory/new.md",
    ]);
  });

  it("rejects a create under a non-active Space folder without misrouting into the active Space source", async () => {
    // Regression: stripTopLevelWorkspaceFolder discards the Spaces/<folder>
    // segment, so before the active-Space guard a create under Spaces/B/
    // silently built sourceKey = activeSpacePrefix + sourcePath and wrote
    // foreign-addressed content into the ACTIVE Space's source.
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
          path: "Spaces/other-team/docs/new.md",
          op: "create",
          content: "# Foreign create\n",
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.files).toEqual([
      expect.objectContaining({
        path: "Spaces/other-team/docs/new.md",
        owner: "space",
        status: "rejected",
        code: "fetched_path_read_only",
      }),
    ]);
    expect(store.puts).toEqual([]);
    expect(
      store.puts.filter((put) =>
        put.key.startsWith("tenants/acme/spaces/board-pack/"),
      ),
    ).toEqual([]);
  });

  it("still writes creates addressed to the active Space folder", async () => {
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
          path: "Spaces/board-pack/docs/new-note.md",
          op: "create",
          content: "# In-lane note\n",
        },
      ],
    });

    expect(result.status).toBe("complete");
    expect(store.puts).toEqual([
      {
        key: "tenants/acme/spaces/board-pack/docs/new-note.md",
        content: "# In-lane note\n",
        ifNoneMatch: "*",
      },
    ]);
  });

  it("resolves the active Space folder for a tenant whose slug is literally 'spaces'", async () => {
    // Regression: activeSpaceFolderSegment used indexOf('/spaces/') on the
    // source prefix, so `tenants/spaces/spaces/board-pack/` matched at the
    // tenant segment and extracted "spaces/board-pack" → "spaces-board-pack",
    // bricking EVERY active-space write as fetched_path_read_only. Parsing
    // by known structure (tenants/<tenant>/spaces/<slug>/) fixes it.
    const spacesTenantContext = { ...context, tenantSlug: "spaces" };
    const spacesTenantManifest = JSON.parse(
      JSON.stringify(hydrateManifest).replaceAll(
        "tenants/acme/",
        "tenants/spaces/",
      ),
    ) as WorkspaceHydrateManifest;
    const store = objectStore();

    const result = await reconcileChangedFiles({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      bucket: "workspace-bucket",
      context: spacesTenantContext,
      hydrateManifest: spacesTenantManifest,
      objectStore: store,
      changedFiles: [
        {
          path: "Spaces/board-pack/docs/new-note.md",
          op: "create",
          content: "# Active-space note\n",
        },
      ],
    });

    expect(result.status).toBe("complete");
    expect(result.files).toEqual([
      expect.objectContaining({
        path: "Spaces/board-pack/docs/new-note.md",
        status: "written",
      }),
    ]);
    expect(store.puts).toEqual([
      {
        key: "tenants/spaces/spaces/board-pack/docs/new-note.md",
        content: "# Active-space note\n",
        ifNoneMatch: "*",
      },
    ]);
  });

  it("rejects bare Spaces paths with an empty source path instead of misrouting", async () => {
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
        { path: "Spaces/INDEX.md", op: "create", content: "# Index\n" },
        {
          path: "Spaces/INDEX.md",
          op: "modify",
          content: "# Index\n",
          base_etag: '"index-old"',
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.files).toEqual([
      expect.objectContaining({
        path: "Spaces/INDEX.md",
        op: "create",
        owner: "unowned",
        status: "rejected",
        code: "unowned_path",
      }),
      expect.objectContaining({
        path: "Spaces/INDEX.md",
        op: "modify",
        owner: "unowned",
        status: "rejected",
        code: "unowned_path",
      }),
    ]);
    expect(store.puts).toEqual([]);
  });

  it("reconciles narrative goal files through the thread goal lane", async () => {
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
          path: "Thread/DECISIONS.md",
          op: "modify",
          content: "# Decisions\n\n- Keep the onboarding lane.\n",
          base_etag: '"decisions-old"',
        },
        {
          path: "Thread/HANDOFFS.md",
          op: "create",
          content: "# Handoffs\n",
        },
      ],
    });

    expect(result.status).toBe("complete");
    expect(store.puts).toEqual([
      {
        key: "tenants/acme/threads/thread-1/DECISIONS.md",
        content: "# Decisions\n\n- Keep the onboarding lane.\n",
        ifMatch: '"decisions-old"',
      },
      {
        key: "tenants/acme/threads/thread-1/HANDOFFS.md",
        content: "# Handoffs\n",
        ifNoneMatch: "*",
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
        { path: "User/memory/new.md", op: "create", content: "# New\n" },
        {
          path: "Spaces/board-pack/docs/brief.md",
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
    const quarantine = quarantineStore();
    const notifications: Array<{
      path: string;
      rule: string;
      key: string | null;
    }> = [];
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
      secretQuarantineStore: quarantine.store,
      secretQuarantineBucket: "quarantine-bucket",
      secretQuarantineKmsKeyId: "kms-key-1",
      notifySecretQuarantine: async (input) => {
        notifications.push({
          path: input.changedFile.path,
          rule: input.rule,
          key: input.quarantineKey,
        });
      },
      changedFiles: [
        { path: "User/memory/ok.md", op: "create", content: "# OK\n" },
        {
          path: "User/memory/conflict.md",
          op: "create",
          content: "# Conflict\n",
        },
        { path: "scratch/tmp.md", op: "create", content: "tmp" },
        { path: "unknown/file.md", op: "create", content: "nope" },
        {
          path: "User/memory/secret.md",
          op: "create",
          content: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
        },
      ],
    });

    expect(result.status).toBe("partial_success");
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "User/memory/ok.md",
          status: "written",
        }),
        expect.objectContaining({
          path: "User/memory/conflict.md",
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
          path: "User/memory/secret.md",
          status: "rejected",
          code: "secret_detected",
          rule: "openai_api_key",
          quarantineKey: expect.stringContaining(
            "tenants/acme/_quarantine/workspace-secrets/thread-1/turn-1/",
          ),
        }),
      ]),
    );
    expect(quarantine.writes).toHaveLength(1);
    expect(quarantine.writes[0]).toMatchObject({
      bucket: "quarantine-bucket",
      content: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
      kmsKeyId: "kms-key-1",
      metadata: {
        tenant_id: "tenant-1",
        thread_id: "thread-1",
        agent_id: "agent-1",
        rule: "openai_api_key",
      },
    });
    expect(quarantine.writes[0]?.metadata).not.toHaveProperty("content");
    expect(notifications).toEqual([
      {
        path: "User/memory/secret.md",
        rule: "openai_api_key",
        key: quarantine.writes[0]?.key,
      },
    ]);
    expect(JSON.stringify(notifications)).not.toContain(
      "sk-abcdefghijklmnopqrstuvwxyz123456",
    );
    expect(store.puts.map((put) => put.key)).not.toContain(
      "tenants/acme/users/eric/memory/secret.md",
    );
  });

  it("allows explicit operator overrides for false-positive secret scans", async () => {
    const store = objectStore();
    const quarantine = quarantineStore();

    const result = await reconcileChangedFiles({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      bucket: "workspace-bucket",
      context,
      hydrateManifest,
      objectStore: store,
      secretQuarantineStore: quarantine.store,
      secretOverride: {
        actorType: "operator",
        operatorId: "operator-1",
        reason: "Test fixture false positive.",
      },
      changedFiles: [
        {
          path: "User/memory/secret.md",
          op: "create",
          content: "fixture=sk-abcdefghijklmnopqrstuvwxyz123456",
        },
      ],
    });

    expect(result.status).toBe("complete");
    expect(store.puts).toEqual([
      {
        key: "tenants/acme/users/eric/memory/secret.md",
        content: "fixture=sk-abcdefghijklmnopqrstuvwxyz123456",
        ifNoneMatch: "*",
      },
    ]);
    expect(quarantine.writes).toEqual([]);
  });

  it("keeps the quarantine key when notification fails after storage", async () => {
    const store = objectStore();
    const quarantine = quarantineStore();

    const result = await reconcileChangedFiles({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      bucket: "workspace-bucket",
      context,
      hydrateManifest,
      objectStore: store,
      secretQuarantineStore: quarantine.store,
      notifySecretQuarantine: async () => {
        throw new Error("notify unavailable");
      },
      changedFiles: [
        {
          path: "User/memory/secret.md",
          op: "create",
          content: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.files[0]).toMatchObject({
      status: "rejected",
      code: "secret_detected",
      quarantineKey: quarantine.writes[0]?.key,
    });
    expect(quarantine.writes).toHaveLength(1);
    expect(store.puts).toEqual([]);
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
        {
          path: "User/memory/preferences.md",
          op: "modify",
          content: "# Prefs\n",
        },
        {
          path: "Spaces/board-pack/docs/brief.md",
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

  it("rejects only the stale ETag file while persisting other changed files", async () => {
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
          path: "Thread/notes/findings.md",
          op: "modify",
          content: "# Stale\n",
          base_etag: '"older-thread-notes"',
        },
        {
          path: "User/memory/new.md",
          op: "create",
          content: "# New\n",
        },
      ],
    });

    expect(result.status).toBe("partial_success");
    expect(result.files).toEqual([
      expect.objectContaining({
        path: "Thread/notes/findings.md",
        status: "rejected",
        code: "base_etag_mismatch",
      }),
      expect.objectContaining({
        path: "User/memory/new.md",
        status: "written",
      }),
    ]);
    expect(store.puts).toEqual([
      {
        key: "tenants/acme/users/eric/memory/new.md",
        content: "# New\n",
        ifNoneMatch: "*",
      },
    ]);
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
        { path: "User/memory/new.md", op: "create", content: "# New\n" },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.files).toEqual([
      expect.objectContaining({
        path: "User/memory/new.md",
        status: "rejected",
        code: "manifest_invalid",
      }),
    ]);
    expect(store.puts).toEqual([]);
  });
});
