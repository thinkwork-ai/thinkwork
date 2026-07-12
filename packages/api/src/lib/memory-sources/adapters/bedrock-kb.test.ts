/**
 * Bedrock KB document-projection adapter tests (THINK-193 U7):
 * frontmatter/normalization, ontology claim extraction (title /
 * effective_date / policy statements, injection-guarded), manifest-driven
 * acquisition with the V1 format gate (PDF defers to the fidelity probe),
 * unchanged-edition dedupe, replacement-edition claim supersession,
 * corroboration survival, and the zero-residue erase scope (KB objects are
 * never deletable by memory-source machinery).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Claim-lifecycle scenarios run upsertClaimsForEvidence for REAL against
// the in-memory fake db (see fake-claims-db.ts usage contract).
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  ...(await import("../test-support/drizzle-condition-mocks.js"))
    .drizzleConditionMocks,
}));
vi.mock("../evidence.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../evidence.js")>()),
  recordAcquiredPage: vi.fn(),
  recordRunItem: vi.fn(),
}));
vi.mock("../repository.js", () => {
  class CheckpointConflictError extends Error {}
  return {
    CheckpointConflictError,
    ensureCheckpoint: vi.fn(),
    getCheckpoint: vi.fn(),
  };
});

import type { Database } from "@thinkwork/database-pg";
import {
  knowledgeBaseDocuments,
  knowledgeBases,
} from "@thinkwork/database-pg/schema";

import { recordAcquiredPage, recordRunItem } from "../evidence.js";
import { ensureCheckpoint } from "../repository.js";
import {
  deactivateOrphanedClaims,
  upsertClaimsForEvidence,
} from "../claims.js";
import {
  makeFakeMemoryDb,
  retractSupportEdges,
  type FakeMemoryStore,
} from "../test-support/fake-claims-db.js";
import { SNAPSHOT_PREFIX, snapshotKeyFor } from "../snapshots.js";
import {
  bedrockKbAdapter,
  buildKbDocumentDossier,
  checkBedrockKbReadiness,
  extractKbDocumentClaims,
  isTextDocumentKey,
  kbDocumentProjectionKey,
  kbDocumentSubjectKey,
  kbEvidenceVersionFor,
  manifestCursorFrom,
  normalizeKbDocument,
  parseFrontmatter,
  unsupportedFormatReason,
  MAX_DOCUMENT_TEXT_BYTES,
  type BedrockKbClient,
} from "./bedrock-kb.js";
import type { AdapterAcquireArgs } from "./registry.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const KB_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const PROCESSOR_ID = "22222222-2222-4222-8222-222222222222";
const DS_ID = "DSABC12345";
const DOC_KEY = "tenants/acme/knowledge-bases/policies/documents/travel.md";

// ---------------------------------------------------------------------------
// Pure normalization / identity
// ---------------------------------------------------------------------------

describe("parseFrontmatter / normalizeKbDocument", () => {
  it("extracts title and effective_date from frontmatter", () => {
    const { frontmatter, body } = parseFrontmatter(
      `---\ntitle: "Travel Policy"\neffective_date: 2026-01-01\nowner: ops\n---\n# Heading\nbody`,
    );
    expect(frontmatter.title).toBe("Travel Policy");
    expect(frontmatter.effectiveDate).toBe("2026-01-01");
    expect(body).toBe("# Heading\nbody");
  });

  it("returns the full text as body when no frontmatter exists", () => {
    const { frontmatter, body } = parseFrontmatter("# Just a doc\ntext");
    expect(frontmatter).toEqual({ title: null, effectiveDate: null });
    expect(body).toBe("# Just a doc\ntext");
  });

  it("title precedence: frontmatter → first heading → basename", () => {
    const fm = normalizeKbDocument({
      documentKey: DOC_KEY,
      edition: 1,
      rawText: "---\ntitle: FM Title\n---\n# H1 Title\ntext",
    });
    expect(fm.title).toBe("FM Title");
    const h1 = normalizeKbDocument({
      documentKey: DOC_KEY,
      edition: 1,
      rawText: "# H1 Title\ntext",
    });
    expect(h1.title).toBe("H1 Title");
    const base = normalizeKbDocument({
      documentKey: DOC_KEY,
      edition: 1,
      rawText: "plain text",
    });
    expect(base.title).toBe("travel.md");
  });

  it("captures heading citations with 1-based line numbers", () => {
    const snap = normalizeKbDocument({
      documentKey: DOC_KEY,
      edition: 2,
      rawText: "# Policy\n\nintro\n\n## Booking\nrules",
    });
    expect(snap.citations).toEqual([
      { heading: "Policy", line: 1 },
      { heading: "Booking", line: 5 },
    ]);
    expect(snap.edition).toBe(2);
    expect(snap.effectiveDate).toBeUndefined();
  });

  it("bounds the text at ~256KB with an explicit truncation marker", () => {
    const big = `# T\n${"a".repeat(MAX_DOCUMENT_TEXT_BYTES + 50_000)}`;
    const snap = normalizeKbDocument({
      documentKey: DOC_KEY,
      edition: 1,
      rawText: big,
    });
    expect(snap.truncated).toBe(true);
    expect(snap.text.endsWith("[…truncated at 256KB]")).toBe(true);
    expect(Buffer.byteLength(snap.text, "utf8")).toBeLessThanOrEqual(
      MAX_DOCUMENT_TEXT_BYTES + 64,
    );
  });

  it("is deterministic for identical inputs", () => {
    const args = { documentKey: DOC_KEY, edition: 3, rawText: "# A\n- b" };
    expect(normalizeKbDocument(args)).toEqual(normalizeKbDocument(args));
  });
});

describe("identity helpers", () => {
  it("projection/subject keys are stable and prefix-tagged", () => {
    expect(kbDocumentProjectionKey(DOC_KEY)).toMatch(/^document:[0-9a-f]{16}$/);
    expect(kbDocumentProjectionKey(DOC_KEY)).toBe(
      kbDocumentProjectionKey(DOC_KEY),
    );
    expect(kbDocumentSubjectKey(DOC_KEY)).toBe(`kb:document:${DOC_KEY}`);
    expect(bedrockKbAdapter.projectionKeyFor(DOC_KEY)).toBe(
      kbDocumentProjectionKey(DOC_KEY),
    );
  });

  it("evidence version embeds edition + content hash", () => {
    expect(kbEvidenceVersionFor(4, "abcdef0123456789deadbeef")).toBe(
      "edition#4#abcdef012345",
    );
  });

  it("V1 format gate: text/markdown parse, PDF defers to the probe", () => {
    expect(isTextDocumentKey("a/b.md")).toBe(true);
    expect(isTextDocumentKey("a/b.markdown")).toBe(true);
    expect(isTextDocumentKey("a/b.TXT")).toBe(true);
    expect(isTextDocumentKey("a/b.pdf")).toBe(false);
    expect(isTextDocumentKey("a/b.docx")).toBe(false);
    expect(unsupportedFormatReason("a/b.pdf")).toBe(
      "pdf_requires_fidelity_probe",
    );
    expect(unsupportedFormatReason("a/b.docx")).toContain("not parsed in V1");
  });

  it("cursor resets when the data source changed (rechunk)", () => {
    const cursor = {
      dataSourceId: "OLD",
      lastUpdatedAt: "2026-01-01T00:00:00.000Z",
      lastId: "x",
    };
    expect(manifestCursorFrom(cursor, "OLD").lastId).toBe("x");
    expect(manifestCursorFrom(cursor, "NEW")).toEqual({
      dataSourceId: "NEW",
      lastUpdatedAt: null,
      lastId: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Claim extraction
// ---------------------------------------------------------------------------

describe("extractKbDocumentClaims", () => {
  const snapshot = normalizeKbDocument({
    documentKey: DOC_KEY,
    edition: 1,
    rawText: [
      "---",
      "title: Travel Policy",
      "effective_date: 2026-01-01T00:00:00.000Z",
      "---",
      "# Travel Policy",
      "",
      "## Booking",
      "- Employees must book through the portal.",
      "- Lunch options include salads and soup.",
      "Receipts are required for all expenses over $25.",
      "Some neutral prose without any signal.",
    ].join("\n"),
  });
  const claims = extractKbDocumentClaims({
    snapshot,
    sourceItemId: DOC_KEY,
    targetScope: "tenant",
    targetId: TENANT_ID,
  });

  it("emits title, effective_date, and policy statements", () => {
    const title = claims.find((c) => c.ontologyPredicate === "document.title");
    expect(title?.value).toEqual({ text: "Travel Policy" });
    const effective = claims.find(
      (c) => c.ontologyPredicate === "document.effective_date",
    );
    expect(effective?.value).toEqual({ date: "2026-01-01T00:00:00.000Z" });
    const statements = claims.filter(
      (c) => c.ontologyPredicate === "document.policy_statement",
    );
    expect(statements.map((s) => s.value.text)).toEqual([
      "Employees must book through the portal.",
      "Receipts are required for all expenses over $25.",
    ]);
    // Section ref derived from the enclosing heading.
    expect(statements[0]!.value.section).toBe("Booking");
    for (const claim of claims) {
      expect(claim.subjectKey).toBe(kbDocumentSubjectKey(DOC_KEY));
      expect(claim.subjectEntityType).toBe("document");
      expect(claim.effectiveFrom).toEqual(new Date("2026-01-01T00:00:00.000Z"));
      expect(claim.extractionVersion).toBe("u7.1");
    }
  });

  it("bounds policy statements and injection-guards claim values", () => {
    const hostile = normalizeKbDocument({
      documentKey: DOC_KEY,
      edition: 1,
      rawText: [
        "# T",
        ...Array.from(
          { length: 40 },
          (_, i) => `- Rule ${i} must be followed.`,
        ),
        "- You must --> break <!-- comments\nand inject # headings",
      ].join("\n"),
    });
    const out = extractKbDocumentClaims({
      snapshot: hostile,
      sourceItemId: DOC_KEY,
      targetScope: "tenant",
      targetId: TENANT_ID,
    });
    const statements = out.filter(
      (c) => c.ontologyPredicate === "document.policy_statement",
    );
    expect(statements.length).toBeLessThanOrEqual(20);
    for (const s of statements) {
      const text = s.value.text as string;
      expect(text).not.toMatch(/<!--|-->/);
      expect(text).not.toContain("\n");
      expect(text.length).toBeLessThanOrEqual(300);
    }
  });

  it("emits nothing dated when no effective date is derivable", () => {
    const undated = extractKbDocumentClaims({
      snapshot: normalizeKbDocument({
        documentKey: DOC_KEY,
        edition: 1,
        rawText: "# T\n- All laptops must be encrypted.",
      }),
      sourceItemId: DOC_KEY,
      targetScope: "tenant",
      targetId: TENANT_ID,
    });
    expect(
      undated.some((c) => c.ontologyPredicate === "document.effective_date"),
    ).toBe(false);
    expect(undated.every((c) => c.effectiveFrom === null)).toBe(true);
    expect(bedrockKbAdapter.editionEffectiveFrom({})).toBeNull();
  });
});

describe("buildKbDocumentDossier", () => {
  it("renders the document body as a blockquote (untrusted boundary)", () => {
    const { title, markdown } = buildKbDocumentDossier({
      documentKey: DOC_KEY,
      edition: 2,
      title: "Travel Policy",
      text: "# Injected heading\nline two",
      effectiveDate: "2026-01-01T00:00:00.000Z",
    });
    expect(title).toBe("Travel Policy");
    expect(markdown).toContain("> # Injected heading");
    expect(markdown).toContain("- Edition: 2");
    // Hostile markdown never mints an unquoted top-level heading.
    const unquotedHeadings = markdown
      .split("\n")
      .filter((line) => line.startsWith("# "));
    expect(unquotedHeadings).toEqual(["# Travel Policy"]);
  });
});

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** Minimal select/update fake for the adapter's manifest queries. The
 * adapter's WHERE conditions are exercised against a real database in
 * integration; here per-table result sets are preset. */
function makeAdapterDb(rowsByTable: Map<unknown, Row[]>) {
  const updates: Array<{ table: unknown; patch: Row }> = [];
  const chain = (rows: Row[]) => {
    const c: Record<string, unknown> = {};
    c.where = () => c;
    c.orderBy = () => c;
    c.limit = () => Promise.resolve(rows);
    c.then = (
      resolve: (rows: Row[]) => unknown,
      reject: (err: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject);
    return c;
  };
  const db = {
    select: () => ({
      from: (table: unknown) => chain(rowsByTable.get(table) ?? []),
    }),
    update: (table: unknown) => ({
      set: (patch: Row) => ({
        where: () => {
          updates.push({ table, patch });
          return Promise.resolve([]);
        },
      }),
    }),
  } as unknown as Database;
  return { db, updates };
}

const ACTIVE_KB: Row = {
  id: KB_ID,
  tenant_id: TENANT_ID,
  slug: "policies",
  status: "active",
  aws_kb_id: "AWSKB123",
  aws_data_source_id: DS_ID,
};

describe("checkBedrockKbReadiness", () => {
  beforeEach(() => {
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
  });

  it("fails closed on a non-uuid binding key", async () => {
    const { db } = makeAdapterDb(new Map());
    const result = await checkBedrockKbReadiness(db as never, {
      tenantId: TENANT_ID,
      bindingKey: "not-a-kb-id",
    });
    expect(result).toMatchObject({ ready: false });
    expect((result as { reason: string }).reason).toContain(
      "knowledge_bases.id",
    );
  });

  it("fails closed when the KB row is missing / not provisioned", async () => {
    const missing = await checkBedrockKbReadiness(
      makeAdapterDb(new Map([[knowledgeBases, []]])).db as never,
      { tenantId: TENANT_ID, bindingKey: KB_ID },
    );
    expect(missing).toMatchObject({ ready: false });

    const unprovisioned = await checkBedrockKbReadiness(
      makeAdapterDb(
        new Map([[knowledgeBases, [{ ...ACTIVE_KB, aws_kb_id: null }]]]),
      ).db as never,
      { tenantId: TENANT_ID, bindingKey: KB_ID },
    );
    expect(unprovisioned).toMatchObject({ ready: false });
    expect((unprovisioned as { reason: string }).reason).toContain(
      "not active/provisioned",
    );
  });

  it("fails closed when the manifest is empty (no sync yet)", async () => {
    const result = await checkBedrockKbReadiness(
      makeAdapterDb(
        new Map<unknown, Row[]>([
          [knowledgeBases, [ACTIVE_KB]],
          [knowledgeBaseDocuments, []],
        ]),
      ).db as never,
      { tenantId: TENANT_ID, bindingKey: KB_ID },
    );
    expect(result).toMatchObject({ ready: false });
    expect((result as { reason: string }).reason).toContain(
      "no document manifest yet",
    );
  });

  it("is ready with an active provisioned KB and a manifest", async () => {
    const result = await checkBedrockKbReadiness(
      makeAdapterDb(
        new Map<unknown, Row[]>([
          [knowledgeBases, [ACTIVE_KB]],
          [knowledgeBaseDocuments, [{ id: "doc-1" }]],
        ]),
      ).db as never,
      { tenantId: TENANT_ID, bindingKey: KB_ID },
    );
    expect(result).toMatchObject({ ready: true });
    const client = (result as { client: BedrockKbClient }).client;
    expect(client.knowledgeBaseId).toBe(KB_ID);
    expect(client.dataSourceId).toBe(DS_ID);
  });
});

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

function manifestRow(overrides: Row = {}): Row {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    tenant_id: TENANT_ID,
    knowledge_base_id: KB_ID,
    data_source_id: DS_ID,
    document_key: DOC_KEY,
    etag: "etag-1",
    edition: 1,
    effective_from: new Date("2026-07-01T00:00:00.000Z"),
    ingest_status: "indexed",
    projection_status: "pending",
    updated_at: new Date("2026-07-02T00:00:00.000Z"),
    ...overrides,
  };
}

function acquireArgs(
  db: Database,
  overrides: Partial<AdapterAcquireArgs> = {},
): AdapterAcquireArgs {
  return {
    db,
    client: {
      knowledgeBaseId: KB_ID,
      awsKnowledgeBaseId: "AWSKB123",
      dataSourceId: DS_ID,
      fetchDocumentText: vi.fn().mockResolvedValue({
        text: "# Doc\n- All data must be encrypted.",
        etag: "etag-1",
      }),
    } satisfies BedrockKbClient,
    processor: {
      id: PROCESSOR_ID,
      tenant_id: TENANT_ID,
      target_scope: "tenant",
      target_id: TENANT_ID,
      created_by_user_id: null,
      budget: {},
    } as never,
    source: {
      id: SOURCE_ID,
      tenant_id: TENANT_ID,
      source_family: "bedrock_kb",
      source_binding_key: KB_ID,
      boundary: { knowledgeBaseIds: [KB_ID] },
      erase_generation: 0,
    } as never,
    workflowRunId: "run-1",
    boundary: { knowledgeBaseIds: [KB_ID] },
    budget: {},
    options: {},
    override: null,
    grantBoundary: { knowledgeBaseIds: [KB_ID] },
    revalidateGrant: vi.fn().mockResolvedValue(undefined),
    eraseFence: { expectedEraseGeneration: 0 },
    counts: { changed: 0, seen: 0, pages: 0 },
    ...overrides,
  };
}

describe("bedrockKbAdapter.runAcquire", () => {
  beforeEach(() => {
    vi.mocked(recordAcquiredPage).mockReset();
    vi.mocked(recordRunItem).mockReset();
    vi.mocked(ensureCheckpoint).mockReset();
    vi.mocked(ensureCheckpoint).mockResolvedValue({
      id: "cp-1",
      version: 1,
      cursor: null,
    } as never);
    vi.mocked(recordAcquiredPage).mockImplementation(
      async (_db, args: { items: unknown[] }) =>
        ({
          changed: args.items,
          seen: 0,
          checkpoint: { id: "cp-1", version: 2, cursor: {} },
        }) as never,
    );
    vi.mocked(recordRunItem).mockResolvedValue(true as never);
  });

  it("is a visible no-op when the boundary does not select the bound KB", async () => {
    const { db } = makeAdapterDb(new Map());
    const outcome = await bedrockKbAdapter.runAcquire(
      acquireArgs(db, { boundary: { knowledgeBaseIds: [] } }),
    );
    expect(outcome).toMatchObject({ ok: true });
    expect(
      (outcome as { summary: Record<string, unknown> }).summary.note,
    ).toContain("not selected");
    expect(recordAcquiredPage).not.toHaveBeenCalled();
  });

  it("projects an indexed markdown document as one evidence page", async () => {
    const row = manifestRow();
    const { db, updates } = makeAdapterDb(
      new Map([[knowledgeBaseDocuments, [row]]]),
    );
    const args = acquireArgs(db);
    const outcome = await bedrockKbAdapter.runAcquire(args);
    expect(outcome).toMatchObject({ ok: true });
    expect(args.revalidateGrant).toHaveBeenCalledTimes(1);

    expect(recordAcquiredPage).toHaveBeenCalledTimes(1);
    const call = vi.mocked(recordAcquiredPage).mock.calls[0]![1] as unknown as {
      items: Array<Record<string, unknown>>;
      nextCursor: Record<string, unknown>;
      eraseFence: unknown;
    };
    expect(call.items).toHaveLength(1);
    const item = call.items[0]!;
    expect(item.sourceItemId).toBe(DOC_KEY);
    expect(item.sourceVersion).toMatch(/^edition#1#[0-9a-f]{12}$/);
    expect((item.normalizedSnapshot as Record<string, unknown>).title).toBe(
      "Doc",
    );
    expect(call.nextCursor).toEqual({
      dataSourceId: DS_ID,
      lastUpdatedAt: (row.updated_at as Date).toISOString(),
      lastId: row.id,
    });
    expect(call.eraseFence).toEqual({ expectedEraseGeneration: 0 });
    // Coarse manifest signal flipped to 'projected'.
    expect(updates.at(-1)?.patch.projection_status).toBe("projected");
    expect(args.counts.changed).toBe(1);
  });

  it("unchanged edition dedupes as a visible 'seen' no-op (no re-projection)", async () => {
    vi.mocked(recordAcquiredPage).mockImplementation(
      async () =>
        ({
          changed: [],
          seen: 1,
          checkpoint: { id: "cp-1", version: 2, cursor: {} },
        }) as never,
    );
    const { db } = makeAdapterDb(
      new Map([[knowledgeBaseDocuments, [manifestRow()]]]),
    );
    const args = acquireArgs(db);
    const outcome = await bedrockKbAdapter.runAcquire(args);
    expect(outcome).toMatchObject({ ok: true });
    expect(args.counts.seen).toBe(1);
    expect(args.counts.changed).toBe(0);
  });

  it("defers a PDF with reason pdf_requires_fidelity_probe and advances past it", async () => {
    const pdf = manifestRow({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      document_key: DOC_KEY.replace(".md", ".pdf"),
    });
    const { db, updates } = makeAdapterDb(
      new Map([[knowledgeBaseDocuments, [pdf]]]),
    );
    const args = acquireArgs(db);
    const outcome = await bedrockKbAdapter.runAcquire(args);
    expect(outcome).toMatchObject({ ok: true });
    expect(
      (outcome as { summary: Record<string, unknown> }).summary.deferred,
    ).toBe(1);

    expect(recordRunItem).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        result: "deferred",
        detail: { reason: "pdf_requires_fidelity_probe" },
      }),
    );
    // Cursor still advances (empty page) so the PDF cannot wedge the run.
    expect(recordAcquiredPage).toHaveBeenCalledTimes(1);
    expect(
      (vi.mocked(recordAcquiredPage).mock.calls[0]![1] as { items: unknown[] })
        .items,
    ).toEqual([]);
    expect(updates[0]?.patch.projection_status).toBe("skipped");
    // No S3 fetch was attempted for the gated format.
    expect(
      (args.client as BedrockKbClient).fetchDocumentText,
    ).not.toHaveBeenCalled();
  });

  it("fails visibly when the document fetch fails (checkpoint untouched)", async () => {
    const { db, updates } = makeAdapterDb(
      new Map([[knowledgeBaseDocuments, [manifestRow()]]]),
    );
    const args = acquireArgs(db);
    (args.client as BedrockKbClient).fetchDocumentText = vi
      .fn()
      .mockRejectedValue(new Error("S3 unavailable"));
    const outcome = await bedrockKbAdapter.runAcquire(args);
    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { error: string }).error).toContain("S3 unavailable");
    expect(recordRunItem).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ result: "failed" }),
    );
    expect(recordAcquiredPage).not.toHaveBeenCalled();
    expect(updates[0]?.patch.projection_status).toBe("failed");
  });

  it("defers when the live etag no longer matches the manifest edition", async () => {
    const { db } = makeAdapterDb(
      new Map([[knowledgeBaseDocuments, [manifestRow({ etag: "old-etag" })]]]),
    );
    const args = acquireArgs(db);
    const outcome = await bedrockKbAdapter.runAcquire(args);
    expect(outcome).toMatchObject({ ok: true });
    expect(recordRunItem).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ result: "deferred" }),
    );
    // Cursor advanced with an EMPTY page — nothing unindexed is projected.
    expect(
      (vi.mocked(recordAcquiredPage).mock.calls[0]![1] as { items: unknown[] })
        .items,
    ).toEqual([]);
  });

  it("stops before the next document when the grant is revoked mid-run", async () => {
    const rows = [
      manifestRow(),
      manifestRow({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        document_key: DOC_KEY.replace("travel", "expenses"),
      }),
    ];
    const { db } = makeAdapterDb(new Map([[knowledgeBaseDocuments, rows]]));
    const args = acquireArgs(db);
    const revalidate = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("revoked"));
    args.revalidateGrant = revalidate;
    await expect(bedrockKbAdapter.runAcquire(args)).rejects.toThrow("revoked");
    // The first document committed; the second was never read.
    expect(recordAcquiredPage).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Claim lifecycle scenarios (real upsertClaimsForEvidence over the fake db)
// ---------------------------------------------------------------------------

const SUBJECT_KEY = kbDocumentSubjectKey(DOC_KEY);

async function applyDocumentEdition(
  db: Database,
  store: FakeMemoryStore,
  args: {
    evidenceItemId: string;
    rawText: string;
    edition: number;
    supersedes?: string;
  },
) {
  if (args.supersedes) retractSupportEdges(store, args.supersedes);
  const snapshot = normalizeKbDocument({
    documentKey: DOC_KEY,
    edition: args.edition,
    rawText: args.rawText,
  });
  const claims = extractKbDocumentClaims({
    snapshot,
    sourceItemId: DOC_KEY,
    targetScope: "tenant",
    targetId: TENANT_ID,
  });
  return await upsertClaimsForEvidence(db, {
    tenantId: TENANT_ID,
    targetScope: "tenant",
    targetId: TENANT_ID,
    sourceConfigId: SOURCE_ID,
    evidenceItemId: args.evidenceItemId,
    subjectKey: SUBJECT_KEY,
    effectiveFrom: bedrockKbAdapter.editionEffectiveFrom(snapshot),
    claims,
  });
}

describe("KB document edition lifecycle (claims)", () => {
  it("a replacement edition supersedes the old title and retracts removed statements", async () => {
    const { db, store } = makeFakeMemoryDb();
    const v1 = [
      "---",
      "title: Travel Policy v1",
      "effective_date: 2026-01-01T00:00:00.000Z",
      "---",
      "- Employees must book through the portal.",
      "- Receipts are required for all expenses.",
    ].join("\n");
    await applyDocumentEdition(db, store, {
      evidenceItemId: "ev-1",
      rawText: v1,
      edition: 1,
    });

    const v2 = [
      "---",
      "title: Travel Policy v2",
      "effective_date: 2026-06-01T00:00:00.000Z",
      "---",
      "- Employees must book through the portal.",
    ].join("\n");
    await applyDocumentEdition(db, store, {
      evidenceItemId: "ev-2",
      rawText: v2,
      edition: 2,
      supersedes: "ev-1",
    });

    const titles = store.claims.filter(
      (c) => c.ontology_predicate === "document.title",
    );
    expect(titles).toHaveLength(2);
    const activeTitle = titles.find((c) => c.status === "active");
    expect(activeTitle?.value).toEqual({ text: "Travel Policy v2" });
    const oldTitle = titles.find((c) => c.status !== "active");
    expect(oldTitle?.status).toBe("superseded");
    expect(oldTitle?.effective_to).toEqual(
      new Date("2026-06-01T00:00:00.000Z"),
    );

    const statements = store.claims.filter(
      (c) => c.ontology_predicate === "document.policy_statement",
    );
    const active = statements.filter((c) => c.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0]!.value).toMatchObject({
      text: "Employees must book through the portal.",
    });
    // The removed statement is retracted (multi-valued zero-support sweep).
    const removed = statements.find(
      (c) =>
        (c.value as { text: string }).text ===
        "Receipts are required for all expenses.",
    );
    expect(removed?.status).toBe("retracted");
  });

  it("a claim corroborated by two documents survives one document's retraction", async () => {
    const { db, store } = makeFakeMemoryDb();
    const text = "# T\n- All laptops must be encrypted.";
    // Two evidence items (two KB source runs) assert the same claim.
    await applyDocumentEdition(db, store, {
      evidenceItemId: "ev-a",
      rawText: text,
      edition: 1,
    });
    await applyDocumentEdition(db, store, {
      evidenceItemId: "ev-b",
      rawText: text,
      edition: 1,
    });

    // Retraction of ev-a's support: the claim keeps ev-b's active edge.
    retractSupportEdges(store, "ev-a");
    const afterFirst = await deactivateOrphanedClaims(db, {
      tenantId: TENANT_ID,
      sourceConfigId: SOURCE_ID,
      evidenceItemId: "ev-a",
    });
    expect(afterFirst).toBe(0);
    const statement = store.claims.find(
      (c) => c.ontology_predicate === "document.policy_statement",
    );
    expect(statement?.status).toBe("active");

    // Losing the LAST support retracts the claim.
    retractSupportEdges(store, "ev-b");
    const afterSecond = await deactivateOrphanedClaims(db, {
      tenantId: TENANT_ID,
      sourceConfigId: SOURCE_ID,
      evidenceItemId: "ev-b",
    });
    // Both of the document's claims (title + statement) lose their last
    // support and retract together.
    expect(afterSecond).toBe(2);
    expect(statement?.status).toBe("retracted");
  });
});

// ---------------------------------------------------------------------------
// Zero-residue erase scope: KB objects are never touched
// ---------------------------------------------------------------------------

describe("erase scope (KB documents untouched)", () => {
  it("evidence snapshots for bedrock_kb live under the evidence-snapshots prefix, never the KB documents prefix", () => {
    const key = snapshotKeyFor({
      tenantId: TENANT_ID,
      sourceConfigId: SOURCE_ID,
      sourceItemId: DOC_KEY,
      sourceVersion: kbEvidenceVersionFor(1, "abcdef0123456789"),
    });
    expect(key.startsWith(`${SNAPSHOT_PREFIX}/`)).toBe(true);
    expect(key.startsWith("tenants/")).toBe(false);
  });

  it("the source-erase S3 deletion prefix can never match a KB document key", () => {
    // deleteEvidenceSnapshotObjects (retraction.ts) deletes ONLY under
    // `${SNAPSHOT_PREFIX}/<tenant>/<source-config>/` in the BRAIN_ARTIFACTS
    // bucket; KB documents live in the WORKSPACE bucket under
    // `tenants/<slug>/knowledge-bases/<kb>/documents/`.
    const erasePrefix = `${SNAPSHOT_PREFIX}/${TENANT_ID}/${SOURCE_ID}/`;
    expect(DOC_KEY.startsWith(erasePrefix)).toBe(false);
    expect(erasePrefix.startsWith("evidence-snapshots/")).toBe(true);
  });

  it("the adapter exposes no delete capability", () => {
    // The MemorySourceAdapter surface is read-project only; deletion of KB
    // documents is owned by the KB manager/files handlers, and Hindsight
    // retraction is chained via the manifest — never the adapter.
    expect(
      Object.keys(bedrockKbAdapter).filter((k) => /delete/i.test(k)),
    ).toEqual([]);
  });
});
