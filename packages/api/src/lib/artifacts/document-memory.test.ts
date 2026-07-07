import { describe, expect, it, vi } from "vitest";
import {
  buildDocumentMemoryContent,
  documentArtifactMemoryId,
  ingestDocumentArtifactMemory,
  DOCUMENT_MEMORY_CONTEXT,
  type DocumentMemoryDeps,
  type DocumentMemoryInput,
} from "./document-memory.js";
import { buildDocumentArtifactRetainOptions } from "../memory/hindsight-retain-params.js";
import type { MemoryAdapter } from "../memory/adapter.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const THREAD_ID = "22222222-2222-2222-2222-222222222222";
const AGENT_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const SPACE_ID = "66666666-6666-6666-6666-666666666666";
const ARTIFACT_ID = "99999999-9999-5999-8999-999999999999";

function baseInput(
  overrides: Partial<DocumentMemoryInput> = {},
): DocumentMemoryInput {
  return {
    tenantId: TENANT_ID,
    threadId: THREAD_ID,
    agentId: AGENT_ID,
    artifactId: ARTIFACT_ID,
    documentId: "doc-1",
    genre: "report",
    title: "Q3 Report",
    abstract: "Numbers are up.",
    digestMarkdown: "## Summary\n\nNumbers are up 18% this quarter.",
    status: "draft",
    headVersion: 0,
    actingUserId: USER_ID,
    spaceId: null,
    emittedAt: "2026-07-06T21:00:00.000Z",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<DocumentMemoryDeps> = {}): {
  deps: DocumentMemoryDeps;
  upserts: Array<Record<string, unknown>>;
} {
  const upserts: Array<Record<string, unknown>> = [];
  const adapter = {
    capabilities: vi.fn(async () => ({ retain: true, spaceMemory: true })),
    upsertMarkdownMemoryDocument: vi.fn(async (req: unknown) => {
      upserts.push(req as Record<string, unknown>);
    }),
  } as unknown as MemoryAdapter;
  const deps: DocumentMemoryDeps = {
    getAdapter: () => adapter,
    loadThreadContext: vi.fn(async () => ({
      userId: USER_ID,
      metadata: null,
    })),
    loadUserName: vi.fn(async () => "Eric Odom"),
    loadAgentName: vi.fn(async () => "Atlas"),
    ...overrides,
  };
  return { deps, upserts };
}

describe("buildDocumentMemoryContent", () => {
  it("prepends a provenance colophon to the digest", () => {
    const content = buildDocumentMemoryContent({
      title: "Q3 Report",
      genre: "report",
      status: "final",
      headVersion: 2,
      abstract: "Numbers are up.",
      digestMarkdown: "## Summary\n\nNumbers are up.",
      agentName: "Atlas",
      userName: "Eric Odom",
      threadId: THREAD_ID,
      artifactId: ARTIFACT_ID,
      emittedAt: "2026-07-06T21:00:00.000Z",
    });
    expect(content).toContain("# Q3 Report");
    expect(content).toContain("Genre: report (final, v2)");
    expect(content).toContain(
      'Emitted: 2026-07-06T21:00:00.000Z by agent "Atlas" for Eric Odom',
    );
    expect(content).toContain(`Thread: ${THREAD_ID}`);
    expect(content).toContain(`Artifact: ${ARTIFACT_ID}`);
    expect(content).toContain("Abstract: Numbers are up.");
    expect(content.endsWith("## Summary\n\nNumbers are up.\n")).toBe(true);
  });

  it("omits author and abstract lines when unresolvable", () => {
    const content = buildDocumentMemoryContent({
      title: "T",
      genre: "plan",
      status: "draft",
      headVersion: 0,
      abstract: "  ",
      digestMarkdown: "body",
      agentName: null,
      userName: null,
      threadId: THREAD_ID,
      artifactId: ARTIFACT_ID,
      emittedAt: "2026-07-06T21:00:00.000Z",
    });
    expect(content).toContain("Genre: plan (draft)");
    expect(content).toContain("Emitted: 2026-07-06T21:00:00.000Z\n");
    expect(content).not.toContain("Abstract:");
    expect(content).not.toContain(" by ");
  });
});

describe("ingestDocumentArtifactMemory", () => {
  it("ingests to the acting user's bank with document tags and replace identity", async () => {
    const { deps, upserts } = makeDeps();
    const result = await ingestDocumentArtifactMemory(baseInput(), deps);
    expect(result).toEqual({
      ingested: true,
      ownerType: "user",
      ownerId: USER_ID,
    });
    expect(upserts).toHaveLength(1);
    const req = upserts[0];
    expect(req.documentId).toBe(documentArtifactMemoryId(ARTIFACT_ID));
    expect(req.context).toBe(DOCUMENT_MEMORY_CONTEXT);
    expect(req.async).toBe(true);
    expect(req.path).toBe(`documents/report/${ARTIFACT_ID}.md`);
    const hindsight = req.hindsight as { tags: string[] };
    expect(hindsight.tags).toContain("source:document");
    expect(hindsight.tags).toContain("scope:document");
    expect(hindsight.tags).toContain("scope:personal");
    const metadata = req.metadata as Record<string, unknown>;
    expect(metadata.source).toBe("document_artifact");
    expect(metadata.artifactId).toBe(ARTIFACT_ID);
    expect(metadata.genre).toBe("report");
  });

  it("routes space-assigned documents to the space bank with space tags", async () => {
    const { deps, upserts } = makeDeps();
    const result = await ingestDocumentArtifactMemory(
      baseInput({ spaceId: SPACE_ID, status: "final", headVersion: 1 }),
      deps,
    );
    expect(result).toEqual({
      ingested: true,
      ownerType: "space",
      ownerId: SPACE_ID,
    });
    const hindsight = upserts[0].hindsight as { tags: string[] };
    expect(hindsight.tags).toContain(`space:${SPACE_ID}`);
    expect(hindsight.tags).toContain("scope:space");
    expect(hindsight.tags).not.toContain("scope:personal");
  });

  it("falls back to the thread owner when there is no acting user", async () => {
    const { deps } = makeDeps();
    const result = await ingestDocumentArtifactMemory(
      baseInput({ actingUserId: null }),
      deps,
    );
    expect(result).toEqual({
      ingested: true,
      ownerType: "user",
      ownerId: USER_ID,
    });
  });

  it("skips when no owner is resolvable", async () => {
    const { deps, upserts } = makeDeps({
      loadThreadContext: vi.fn(async () => ({ userId: null, metadata: null })),
    });
    const result = await ingestDocumentArtifactMemory(
      baseInput({ actingUserId: null }),
      deps,
    );
    expect(result).toEqual({ ingested: false, reason: "no_owner" });
    expect(upserts).toHaveLength(0);
  });

  it("skips eval-traffic threads", async () => {
    const { deps, upserts } = makeDeps({
      loadThreadContext: vi.fn(async () => ({
        userId: USER_ID,
        metadata: { evalTraffic: true },
      })),
    });
    const result = await ingestDocumentArtifactMemory(baseInput(), deps);
    expect(result).toEqual({ ingested: false, reason: "eval_traffic" });
    expect(upserts).toHaveLength(0);
  });

  it("skips when the engine lacks markdown-document support", async () => {
    const adapter = {
      capabilities: vi.fn(async () => ({ retain: true })),
    } as unknown as MemoryAdapter;
    const { deps, upserts } = makeDeps({ getAdapter: () => adapter });
    const result = await ingestDocumentArtifactMemory(baseInput(), deps);
    expect(result).toEqual({ ingested: false, reason: "engine_unsupported" });
    expect(upserts).toHaveLength(0);
  });
});

describe("buildDocumentArtifactRetainOptions", () => {
  it("personal scope without a space; space scope with one", () => {
    const personal = buildDocumentArtifactRetainOptions({
      timestamp: "2026-07-06T21:00:00.000Z",
    });
    expect(personal.tags).toEqual([
      "source:document",
      "surface:pi",
      "scope:document",
      "scope:personal",
    ]);
    expect(personal.timestamp).toBe("2026-07-06T21:00:00.000Z");
    expect(personal.observationScopes).toContainEqual(["scope:personal"]);

    const spaced = buildDocumentArtifactRetainOptions({
      spaceId: SPACE_ID,
      timestamp: null,
    });
    expect(spaced.tags).toContain(`space:${SPACE_ID}`);
    expect(spaced.tags).toContain("scope:space");
    expect(spaced.timestamp).toBe("unset");
    expect(spaced.observationScopes).toContainEqual([`space:${SPACE_ID}`]);
  });
});
