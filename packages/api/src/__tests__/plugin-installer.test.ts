import { describe, expect, it, vi } from "vitest";

import {
  type PluginInstallerDb,
  type PluginInstallerS3,
  runPluginInstallSaga,
  sha256Hex,
} from "../lib/plugin-installer.js";
import type { ValidatedPlugin } from "../lib/plugin-validator.js";

// ---------------------------------------------------------------------------
// Fake implementations — in-memory so the saga exercises every branch
// without touching Aurora or S3.
// ---------------------------------------------------------------------------

function makeFakeDb(
  overrides: Partial<PluginInstallerDb> = {},
): PluginInstallerDb & {
  rows: Map<string, { status: string; errorMessage: string | null }>;
  inserted: Array<{ uploadId: string }>;
  completeCalls: number;
} {
  const rows = new Map<
    string,
    { status: string; errorMessage: string | null }
  >();
  const inserted: Array<{ uploadId: string }> = [];
  let seq = 0;
  return {
    async insertPluginUploadStaging() {
      seq += 1;
      const uploadId = `upload-${seq}`;
      rows.set(uploadId, { status: "staging", errorMessage: null });
      inserted.push({ uploadId });
      return { uploadId };
    },
    async completeInstall({ uploadId }) {
      const row = rows.get(uploadId);
      if (!row) throw new Error(`unknown uploadId: ${uploadId}`);
      row.status = "installed";
    },
    async markFailed({ uploadId, errorMessage }) {
      const row = rows.get(uploadId);
      if (!row) return;
      row.status = "failed";
      row.errorMessage = errorMessage;
    },
    rows,
    inserted,
    completeCalls: 0,
    ...overrides,
  };
}

function makeFakeS3(
  impl?: (args: {
    canonicalPrefix: string;
    files: Array<{ relPath: string; body: string }>;
  }) => Promise<void>,
): PluginInstallerS3 & {
  calls: Array<{
    canonicalPrefix: string;
    files: Array<{ relPath: string; body: string }>;
  }>;
} {
  const calls: Array<{
    canonicalPrefix: string;
    files: Array<{ relPath: string; body: string }>;
  }> = [];
  return {
    async writeBundle(args) {
      calls.push(args);
      if (impl) await impl(args);
    },
    calls,
  };
}

function buildPlugin(
  overrides: Partial<ValidatedPlugin> = {},
): ValidatedPlugin {
  return {
    name: "demo",
    version: "1.0.0",
    description: "test",
    author: "eric",
    skills: [
      {
        path: "skills/alpha/SKILL.md",
        name: "alpha",
        description: "alpha skill",
        allowedToolsDeclared: [],
        body: "alpha body",
      },
    ],
    mcpServers: [
      {
        name: "crm",
        url: "https://crm.example.test/mcp",
        source: "plugin.json",
      },
    ],
    agents: undefined,
    userConfig: undefined,
    allowedToolsDeclared: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("runPluginInstallSaga — happy path", () => {
  it("writes every phase and returns installed on a clean 3-skill + 1-MCP bundle", async () => {
    const db = makeFakeDb();
    const s3 = makeFakeS3();
    const plugin = buildPlugin({
      skills: [
        {
          path: "skills/a/SKILL.md",
          name: "a",
          description: "a",
          allowedToolsDeclared: [],
          body: "a body",
        },
        {
          path: "skills/b/SKILL.md",
          name: "b",
          description: "b",
          allowedToolsDeclared: [],
          body: "b body",
        },
        {
          path: "skills/c/SKILL.md",
          name: "c",
          description: "c",
          allowedToolsDeclared: [],
          body: "c body",
        },
      ],
    });

    const result = await runPluginInstallSaga(
      {
        tenantId: "tenant-a",
        uploadedBy: "user-a",
        stagingPrefix: "tenants/tenant-a/_plugin-uploads/u1/bundle.zip",
        bundleSha256: sha256Hex(Buffer.from("zip")),
        plugin,
        bundleFiles: plugin.skills.map((s) => ({
          relPath: `skills/${s.name}/SKILL.md`,
          body: s.body,
        })),
        canonicalPrefix: (tid, name) => `tenants/${tid}/skills/${name}`,
      },
      { db, s3 },
    );

    expect(result.status).toBe("installed");
    if (result.status !== "installed") throw new Error("unreachable");
    expect(result.pluginName).toBe("demo");
    expect(result.skills.map((s) => s.slug)).toEqual(["a", "b", "c"]);
    expect(db.inserted).toHaveLength(1);
    expect(db.rows.get(result.uploadId)?.status).toBe("installed");
    // S3 phase-2 wrote under the canonical prefix, not the staging one.
    expect(s3.calls).toHaveLength(1);
    expect(s3.calls[0]?.canonicalPrefix).toBe("tenants/tenant-a/skills/demo");
    expect(s3.calls[0]?.files).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Phase failures
// ---------------------------------------------------------------------------

describe("runPluginInstallSaga — phase-1 failure", () => {
  it("returns failed with phase='phase-1' when the audit insert fails", async () => {
    const db = makeFakeDb();
    const originalInsert = db.insertPluginUploadStaging.bind(db);
    db.insertPluginUploadStaging = async () => {
      throw new Error("DB blew up");
    };
    const s3 = makeFakeS3();

    const result = await runPluginInstallSaga(
      {
        tenantId: "t",
        uploadedBy: null,
        stagingPrefix: "tenants/t/_plugin-uploads/u/bundle.zip",
        bundleSha256: "x",
        plugin: buildPlugin(),
        bundleFiles: [],
        canonicalPrefix: () => "canonical",
      },
      { db, s3 },
    );

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.phase).toBe("phase-1");
    expect(result.errorMessage).toContain("DB blew up");
    // Phase-1 never got a row, so nothing to mark failed.
    expect(db.inserted).toHaveLength(0);
    // Phase-2 must not have run.
    expect(s3.calls).toHaveLength(0);

    // Restore for any subsequent use.
    db.insertPluginUploadStaging = originalInsert;
  });
});

describe("runPluginInstallSaga — phase-2 failure", () => {
  it("marks the row failed with the S3 error message and skips phase-3", async () => {
    const db = makeFakeDb();
    const completeSpy = vi.spyOn(db, "completeInstall");
    const s3 = makeFakeS3(async () => {
      throw new Error("S3 AccessDenied");
    });

    const result = await runPluginInstallSaga(
      {
        tenantId: "t",
        uploadedBy: null,
        stagingPrefix: "tenants/t/_plugin-uploads/u/bundle.zip",
        bundleSha256: "x",
        plugin: buildPlugin(),
        bundleFiles: [{ relPath: "skills/demo/SKILL.md", body: "x" }],
        canonicalPrefix: () => "canonical",
      },
      { db, s3 },
    );

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.phase).toBe("phase-2");
    expect(result.errorMessage).toContain("S3 AccessDenied");
    // Phase-1 row was created and then marked failed with the S3 error.
    expect(db.inserted).toHaveLength(1);
    expect(db.rows.get(result.uploadId)?.status).toBe("failed");
    expect(db.rows.get(result.uploadId)?.errorMessage).toContain(
      "S3 AccessDenied",
    );
    expect(completeSpy).not.toHaveBeenCalled();
  });
});

describe("runPluginInstallSaga — phase-3 failure", () => {
  it("marks the row failed with the phase-3 error, leaves S3 writes in place", async () => {
    const db = makeFakeDb();
    db.completeInstall = async () => {
      throw new Error("FK constraint on tenant_skills");
    };
    const s3 = makeFakeS3();

    const result = await runPluginInstallSaga(
      {
        tenantId: "t",
        uploadedBy: null,
        stagingPrefix: "tenants/t/_plugin-uploads/u/bundle.zip",
        bundleSha256: "x",
        plugin: buildPlugin(),
        bundleFiles: [{ relPath: "skills/demo/SKILL.md", body: "x" }],
        canonicalPrefix: () => "canonical",
      },
      { db, s3 },
    );

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.phase).toBe("phase-3");
    // S3 write was already done by phase-2 — the saga's responsibility
    // to reap that sits with the sweeper (separate PR). Assert phase-2
    // did happen so the sweeper will find the orphan.
    expect(s3.calls).toHaveLength(1);
    expect(db.rows.get(result.uploadId)?.status).toBe("failed");
    expect(db.rows.get(result.uploadId)?.errorMessage).toContain(
      "FK constraint",
    );
  });
});

describe("runPluginInstallSaga — markFailed itself failing", () => {
  it("does not re-raise when markFailed throws — sweeper is the backstop", async () => {
    const db = makeFakeDb();
    db.markFailed = async () => {
      throw new Error("markFailed also broken");
    };
    const s3 = makeFakeS3(async () => {
      throw new Error("original S3 failure");
    });

    const result = await runPluginInstallSaga(
      {
        tenantId: "t",
        uploadedBy: null,
        stagingPrefix: "x",
        bundleSha256: "y",
        plugin: buildPlugin(),
        bundleFiles: [],
        canonicalPrefix: () => "canonical",
      },
      { db, s3 },
    );

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.phase).toBe("phase-2");
    // The original failure reason is what the caller sees — not the
    // secondary markFailed error.
    expect(result.errorMessage).toBe("original S3 failure");
  });
});

// ---------------------------------------------------------------------------
// sha256Hex
// ---------------------------------------------------------------------------

describe("sha256Hex", () => {
  it("matches the canonical hash so re-uploads can be deduped", () => {
    expect(sha256Hex(Buffer.from(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex(Buffer.from("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});
