import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));

import {
  createPrefixedWorkspaceClient,
  exportSkillArchive,
  importSkillArchive,
  spacesWorkspaceFilesClient,
  validateSkillDraft,
} from "./workspace-files-api";

function lastBody(): Record<string, unknown> {
  const [, init] = apiFetch.mock.calls.at(-1)!;
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockResolvedValue({ ok: true, files: [] });
});

describe("spacesWorkspaceFilesClient target scoping", () => {
  it("sends exactly the userId target for per-user edits (AE6)", async () => {
    await spacesWorkspaceFilesClient.putFile(
      { userId: "user-9" },
      "notes.md",
      "hello",
    );
    const body = lastBody();
    expect(body).toEqual({
      action: "put",
      userId: "user-9",
      path: "notes.md",
      content: "hello",
    });
    // Never the consolidated client's multi-source fan-out.
    expect(body.agentId).toBeUndefined();
    expect(body.spaceId).toBeUndefined();
  });

  it("sends exactly the spaceId target for per-Space lists", async () => {
    await spacesWorkspaceFilesClient.listFiles({ spaceId: "space-1" });
    expect(lastBody()).toEqual({ action: "list", spaceId: "space-1" });
  });

  it("sends exactly the agentId target for Main Agent reads", async () => {
    apiFetch.mockResolvedValueOnce({
      content: "x",
      source: "agent",
      sha256: "s",
    });
    await spacesWorkspaceFilesClient.getFile(
      { agentId: "agent-1" },
      "AGENTS.md",
    );
    expect(lastBody()).toEqual({
      action: "get",
      agentId: "agent-1",
      path: "AGENTS.md",
    });
  });

  it("sends exactly the skillDraftId target for draft edits", async () => {
    await spacesWorkspaceFilesClient.putFile(
      { skillDraftId: "draft-1" },
      "SKILL.md",
      "---\nname: draft-1\n---\n",
    );
    expect(lastBody()).toEqual({
      action: "put",
      skillDraftId: "draft-1",
      path: "SKILL.md",
      content: "---\nname: draft-1\n---\n",
    });
  });
});

describe("createPrefixedWorkspaceClient", () => {
  const client = createPrefixedWorkspaceClient("agents/");

  it("lists only the subtree and strips the prefix", async () => {
    apiFetch.mockResolvedValueOnce({
      files: [
        { path: "AGENTS.md", source: "agent", sha256: "" },
        { path: "agents/research.md", source: "agent", sha256: "" },
        { path: "agents/review/notes.md", source: "agent", sha256: "" },
        { path: "skills/web/SKILL.md", source: "agent", sha256: "" },
      ],
    });
    const { files } = await client.listFiles({ agentId: "agent-1" });
    expect(files.map((f) => f.path)).toEqual([
      "research.md",
      "review/notes.md",
    ]);
  });

  it("re-prefixes reads and writes against the same single target", async () => {
    apiFetch.mockResolvedValueOnce({
      content: "x",
      source: "agent",
      sha256: "s",
    });
    await client.getFile({ agentId: "agent-1" }, "research.md");
    expect(lastBody()).toEqual({
      action: "get",
      agentId: "agent-1",
      path: "agents/research.md",
    });

    await client.putFile({ agentId: "agent-1" }, "research.md", "body");
    expect(lastBody()).toMatchObject({
      action: "put",
      agentId: "agent-1",
      path: "agents/research.md",
    });

    await client.deleteFile({ agentId: "agent-1" }, "research.md");
    expect(lastBody()).toEqual({
      action: "delete",
      agentId: "agent-1",
      path: "agents/research.md",
    });
  });

  it("re-prefixes renames and returns subtree-relative destinations", async () => {
    apiFetch.mockResolvedValueOnce({ destPath: "agents/renamed.md" });
    const result = await client.renamePath?.(
      { agentId: "agent-1" },
      "research.md",
      "renamed.md",
    );
    expect(lastBody()).toEqual({
      action: "rename",
      agentId: "agent-1",
      fromPath: "agents/research.md",
      toPath: "agents/renamed.md",
    });
    expect(result?.destPath).toBe("renamed.md");
  });

  it("normalizes a prefix without a trailing slash", async () => {
    const bare = createPrefixedWorkspaceClient("agents");
    await bare.putFile({ agentId: "agent-1" }, "x.md", "y");
    expect(lastBody()).toMatchObject({ path: "agents/x.md" });
  });
});

describe("exportSkillArchive", () => {
  it("requests a catalog export and exposes download-ready archive bytes", async () => {
    const archiveBytes = Uint8Array.from([0x00, 0xff, 0x7f]);
    apiFetch.mockResolvedValueOnce({
      ok: true,
      slug: "pdf-processing",
      filename: "pdf-processing.zip",
      contentType: "application/zip",
      archiveBase64: Buffer.from(archiveBytes).toString("base64"),
    });

    const archive = await exportSkillArchive("pdf-processing");

    expect(lastBody()).toEqual({
      action: "export-skill",
      catalog: true,
      slug: "pdf-processing",
    });
    expect(archive).toMatchObject({
      slug: "pdf-processing",
      filename: "pdf-processing.zip",
      contentType: "application/zip",
      archiveBase64: Buffer.from(archiveBytes).toString("base64"),
    });
    expect(Array.from(archive.bytes)).toEqual(Array.from(archiveBytes));
    expect(archive.blob.type).toBe("application/zip");
    expect(archive.blob.size).toBe(archiveBytes.byteLength);
  });

  it("defaults optional export metadata for download payloads", async () => {
    const archiveBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
    apiFetch.mockResolvedValueOnce({
      ok: true,
      filename: "fallback.zip",
      archiveBase64: Buffer.from(archiveBytes).toString("base64"),
    });

    const archive = await exportSkillArchive("fallback-skill");

    expect(archive.slug).toBe("fallback-skill");
    expect(archive.contentType).toBe("application/zip");
    expect(archive.blob.type).toBe("application/zip");
    expect(Array.from(archive.bytes)).toEqual(Array.from(archiveBytes));
  });

  it("fails loudly when the export response omits archive data", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, filename: "missing.zip" });

    await expect(exportSkillArchive("missing")).rejects.toThrow(
      "missing archive data",
    );
  });
});

describe("importSkillArchive", () => {
  it("submits a catalog skill archive import", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      slug: "pdf-processing",
      status: "created",
      generatedWiring: true,
    });

    const result = await importSkillArchive("UEsDBAo=");

    expect(lastBody()).toEqual({
      action: "import-skill",
      catalog: true,
      archiveBase64: "UEsDBAo=",
    });
    expect(result).toEqual({
      slug: "pdf-processing",
      status: "created",
      generatedWiring: true,
    });
  });

  it("passes confirmed replacement and preserves non-fatal warnings", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      slug: "pdf-processing",
      status: "updated",
      generatedWiring: false,
      indexWarning: "Rebuild the catalog index.",
      evalDatasetWarning: "Eval dataset sync failed.",
    });

    const result = await importSkillArchive("UEsDBAo=", {
      confirmReplace: true,
    });

    expect(lastBody()).toEqual({
      action: "import-skill",
      catalog: true,
      archiveBase64: "UEsDBAo=",
      confirmReplace: true,
    });
    expect(result).toEqual({
      slug: "pdf-processing",
      status: "updated",
      generatedWiring: false,
      indexWarning: "Rebuild the catalog index.",
      evalDatasetWarning: "Eval dataset sync failed.",
    });
  });

  it("fails loudly when the import response omits metadata", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, slug: "missing-status" });

    await expect(importSkillArchive("UEsDBAo=")).rejects.toThrow(
      "missing import metadata",
    );
  });
});

describe("validateSkillDraft", () => {
  it("requests validation for a skill draft target", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      slug: "draft-helper",
      generatedWiring: true,
      currentContentHash: "sha256:abc",
      files: [
        { path: "SKILL.md", bytes: 64 },
        { path: "WIRING.md", bytes: 128 },
      ],
    });

    const result = await validateSkillDraft("draft-1");

    expect(lastBody()).toEqual({
      action: "validate-skill-draft",
      skillDraftId: "draft-1",
    });
    expect(result).toEqual({
      slug: "draft-helper",
      generatedWiring: true,
      currentContentHash: "sha256:abc",
      files: [
        { path: "SKILL.md", bytes: 64 },
        { path: "WIRING.md", bytes: 128 },
      ],
    });
  });
});
