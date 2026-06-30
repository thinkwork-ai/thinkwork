import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch, readRuntimeEnv } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  readRuntimeEnv: vi.fn((_key?: string) => ""),
}));
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));
vi.mock("@/lib/runtime-config", () => ({ readRuntimeEnv }));

import {
  createPrefixedWorkspaceClient,
  exportSkillArchive,
  fixSkillTrustEvidence,
  getSkillTrustReport,
  importSkillArchive,
  importSkillArchiveAsDraft,
  listSkillSummaries,
  runSkillTrustPipeline,
  spacesWorkspaceFilesClient,
  validateSkillDraft,
} from "./workspace-files-api";

function lastBody(): Record<string, unknown> {
  const [, init] = apiFetch.mock.calls.at(-1)!;
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  readRuntimeEnv.mockReturnValue("");
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

describe("listSkillSummaries", () => {
  it("uses the narrow skill trust API override when configured", async () => {
    readRuntimeEnv.mockImplementation((key?: string) =>
      key === "VITE_SKILL_TRUST_API_URL" ? "http://127.0.0.1:8787" : "",
    );
    apiFetch.mockResolvedValueOnce({
      ok: true,
      skills: [
        {
          slug: "account-health-review",
          displayName: "Account Health Review",
          category: null,
          icon: null,
          tags: null,
          sha: "sha",
          trustStatus: "passed",
          trustStale: false,
          skillCardStatus: "starter_generated",
        },
      ],
    });

    const summaries = await listSkillSummaries();

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/files",
      expect.objectContaining({ baseUrl: "http://127.0.0.1:8787" }),
    );
    expect(lastBody()).toEqual({
      action: "list",
      catalog: true,
      summary: true,
    });
    expect(summaries[0]?.trustStatus).toBe("passed");
    expect(summaries[0]?.skillCardStatus).toBe("starter_generated");
  });
});

describe("runSkillTrustPipeline", () => {
  it("requests a catalog trust run and returns the report", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      trustReport: {
        slug: "account-health-review",
        contentHash: "a".repeat(64),
        generatedAt: "2026-06-21T00:00:00.000Z",
        status: "review",
        summary: "SkillSpector is not configured.",
        spec: {
          status: "passed",
          allowedTools: [],
          errors: [],
        },
        scanner: { status: "not_configured" },
        severityCounts: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
        findings: [],
        evidence: {
          skillCard: "missing",
          evalDataset: "missing",
          benchmark: "missing",
          signature: "missing",
        },
        artifactPaths: { evals: [] },
      },
    });

    const report = await runSkillTrustPipeline("account-health-review");

    expect(lastBody()).toEqual({
      action: "run-skill-trust",
      catalog: true,
      slug: "account-health-review",
    });
    expect(report.slug).toBe("account-health-review");
    expect(report.scanner.status).toBe("not_configured");
  });

  it("requests a draft trust run against the draft target", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      trustReport: {
        slug: "draft-helper",
        contentHash: "a".repeat(64),
        generatedAt: "2026-06-21T00:00:00.000Z",
        status: "review",
        summary: "Draft trust report.",
        spec: { status: "passed", allowedTools: [], errors: [] },
        scanner: { status: "not_configured" },
        severityCounts: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
        findings: [],
        evidence: {
          skillCard: "missing",
          evalDataset: "missing",
          benchmark: "missing",
          signature: "missing",
        },
        artifactPaths: { evals: [] },
      },
    });

    const report = await runSkillTrustPipeline({
      skillDraftId: "draft-1",
      slug: "draft-helper",
    });

    expect(lastBody()).toEqual({
      action: "run-skill-trust",
      skillDraftId: "draft-1",
      slug: "draft-helper",
    });
    expect(report.slug).toBe("draft-helper");
  });

  it("uses the narrow skill trust API override when configured", async () => {
    readRuntimeEnv.mockImplementation((key?: string) =>
      key === "VITE_SKILL_TRUST_API_URL" ? "http://127.0.0.1:8787" : "",
    );
    apiFetch.mockResolvedValueOnce({
      ok: true,
      trustReport: {
        slug: "account-health-review",
        contentHash: "a".repeat(64),
        generatedAt: "2026-06-21T00:00:00.000Z",
        status: "passed",
        summary: "SkillSpector passed.",
        spec: {
          status: "passed",
          allowedTools: [],
          errors: [],
        },
        scanner: { status: "completed" },
        severityCounts: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
        findings: [],
        evidence: {
          skillCard: "missing",
          evalDataset: "missing",
          benchmark: "missing",
          signature: "missing",
        },
        artifactPaths: { evals: [] },
      },
    });

    await runSkillTrustPipeline("account-health-review");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/files",
      expect.objectContaining({ baseUrl: "http://127.0.0.1:8787" }),
    );
  });

  it("fails loudly when the trust response omits the report", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true });

    await expect(runSkillTrustPipeline("missing")).rejects.toThrow(
      "missing a report",
    );
  });
});

describe("getSkillTrustReport", () => {
  it("requests the cached catalog trust report", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      slug: "account-health-review",
      cached: true,
      stale: false,
      trustReportContentSha: "catalog-sha",
      trustReportPipelineVersion: "thinkwork-skill-trust-v1",
      trustReport: {
        slug: "account-health-review",
        contentHash: "a".repeat(64),
        generatedAt: "2026-06-21T00:00:00.000Z",
        status: "passed",
        summary: "Cached report.",
        spec: {
          status: "passed",
          allowedTools: [],
          errors: [],
        },
        scanner: { status: "completed" },
        severityCounts: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
        findings: [],
        evidence: {
          skillCard: "present",
          evalDataset: "present",
          benchmark: "present",
          signature: "missing",
        },
        artifactPaths: { evals: [] },
      },
    });

    const result = await getSkillTrustReport("account-health-review");

    expect(lastBody()).toEqual({
      action: "get-skill-trust",
      catalog: true,
      slug: "account-health-review",
    });
    expect(result.cached).toBe(true);
    expect(result.stale).toBe(false);
    expect(result.trustReport?.summary).toBe("Cached report.");
  });

  it("requests the cached draft trust report against the draft target", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      slug: "draft-helper",
      cached: false,
      stale: false,
      trustReport: null,
    });

    const result = await getSkillTrustReport({
      skillDraftId: "draft-1",
      slug: "draft-helper",
    });

    expect(lastBody()).toEqual({
      action: "get-skill-trust",
      skillDraftId: "draft-1",
      slug: "draft-helper",
    });
    expect(result.slug).toBe("draft-helper");
    expect(result.trustReport).toBeNull();
  });

  it("returns an empty cache result without a report", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      slug: "missing",
      cached: false,
      stale: false,
      trustReport: null,
    });

    const result = await getSkillTrustReport("missing");

    expect(result.trustReport).toBeNull();
    expect(result.cached).toBe(false);
  });
});

describe("fixSkillTrustEvidence", () => {
  it("requests a catalog evidence fix and returns the refreshed report", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      slug: "account-health-review",
      fixedStep: {
        step: "skillCard",
        status: "generated",
        message: "Generated skill-card.md.",
      },
      artifactPath: "skill-card.md",
      indexWarning: "Rebuild the catalog index.",
      trustReport: {
        slug: "account-health-review",
        contentHash: "a".repeat(64),
        generatedAt: "2026-06-22T00:00:00.000Z",
        status: "passed",
        summary: "SkillSpector passed; all release evidence is present.",
        spec: {
          status: "passed",
          allowedTools: [],
          errors: [],
        },
        scanner: { status: "completed" },
        severityCounts: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
        findings: [],
        evidence: {
          skillCard: "starter_generated",
          evalDataset: "missing",
          benchmark: "missing",
          signature: "missing",
        },
        artifactPaths: { skillCard: "skill-card.md", evals: [] },
      },
    });

    const result = await fixSkillTrustEvidence(
      "account-health-review",
      "skillCard",
    );

    expect(lastBody()).toEqual({
      action: "fix-skill-trust-evidence",
      catalog: true,
      slug: "account-health-review",
      step: "skillCard",
    });
    expect(result.fixedStep).toEqual({
      step: "skillCard",
      status: "generated",
      message: "Generated skill-card.md.",
    });
    expect(result.artifactPath).toBe("skill-card.md");
    expect(result.indexWarning).toBe("Rebuild the catalog index.");
    expect(result.trustReport.evidence.skillCard).toBe("starter_generated");
  });

  it("requests a draft evidence fix against the draft target", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      slug: "draft-helper",
      fixedStep: {
        step: "benchmark",
        status: "generated",
        message: "Generated BENCHMARK.md.",
      },
      artifactPath: "BENCHMARK.md",
      trustReport: {
        slug: "draft-helper",
        contentHash: "b".repeat(64),
        generatedAt: "2026-06-22T00:00:00.000Z",
        status: "review",
        summary: "Generated benchmark evidence.",
        spec: { status: "passed", allowedTools: [], errors: [] },
        scanner: { status: "not_configured" },
        severityCounts: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
        findings: [],
        evidence: {
          skillCard: "present",
          evalDataset: "present",
          benchmark: "starter_generated",
          signature: "missing",
        },
        artifactPaths: {
          skillCard: "skill-card.md",
          evals: ["evals/smoke.json"],
          benchmark: "BENCHMARK.md",
        },
      },
    });

    const result = await fixSkillTrustEvidence(
      { skillDraftId: "draft-1", slug: "draft-helper" },
      "benchmark",
    );

    expect(lastBody()).toEqual({
      action: "fix-skill-trust-evidence",
      skillDraftId: "draft-1",
      slug: "draft-helper",
      step: "benchmark",
    });
    expect(result.artifactPath).toBe("BENCHMARK.md");
  });

  it("uses the narrow skill trust API override when configured", async () => {
    readRuntimeEnv.mockImplementation((key?: string) =>
      key === "VITE_SKILL_TRUST_API_URL" ? "http://localhost:8787" : "",
    );
    apiFetch.mockResolvedValueOnce({
      ok: true,
      slug: "account-health-review",
      fixedStep: {
        step: "signature",
        status: "generated",
        message: "Generated unverified skill.oms.sig approval evidence.",
      },
      artifactPath: "skill.oms.sig",
      signedPayloadHash: "b".repeat(64),
      trustReport: {
        slug: "account-health-review",
        contentHash: "a".repeat(64),
        signedPayloadHash: "b".repeat(64),
        generatedAt: "2026-06-22T00:00:00.000Z",
        status: "passed",
        summary: "Signature evidence is present.",
        spec: {
          status: "passed",
          allowedTools: [],
          errors: [],
        },
        scanner: { status: "completed" },
        severityCounts: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
        findings: [],
        evidence: {
          skillCard: "present",
          evalDataset: "present",
          benchmark: "present",
          signature: "approved_unverified",
        },
        artifactPaths: { evals: [], signature: "skill.oms.sig" },
      },
    });

    const result = await fixSkillTrustEvidence(
      "account-health-review",
      "signature",
    );

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/files",
      expect.objectContaining({ baseUrl: "http://localhost:8787" }),
    );
    expect(result.artifactPath).toBe("skill.oms.sig");
    expect(result.signedPayloadHash).toBe("b".repeat(64));
  });

  it("fails loudly when the fix response omits fix metadata", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true });

    await expect(
      fixSkillTrustEvidence("account-health-review", "benchmark"),
    ).rejects.toThrow("missing fix metadata");
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

describe("importSkillArchiveAsDraft", () => {
  it("submits a catalog skill archive as a draft", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      draftId: "draft-1",
      slug: "pdf-processing",
      status: "submitted",
      generatedWiring: true,
      currentContentHash: "sha256:abc",
    });

    const result = await importSkillArchiveAsDraft("UEsDBAo=");

    expect(lastBody()).toEqual({
      action: "import-skill-draft",
      catalog: true,
      archiveBase64: "UEsDBAo=",
    });
    expect(result).toEqual({
      draftId: "draft-1",
      slug: "pdf-processing",
      status: "submitted",
      generatedWiring: true,
      currentContentHash: "sha256:abc",
    });
  });

  it("fails loudly when the draft import response omits metadata", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      slug: "missing-draft-id",
      status: "submitted",
    });

    await expect(importSkillArchiveAsDraft("UEsDBAo=")).rejects.toThrow(
      "missing draft metadata",
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
