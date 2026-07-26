/**
 * knowledge-base-files tests (THINK-345 U1) — the module's first suite.
 *
 * Scope is the `listManifest` action, which THINK-345 widened so the KB
 * detail rail can render one document's indexing state without a per-row
 * round trip. These tests pin:
 *
 *   - the widened fields round-trip, including nulls (the rail renders
 *     documents the transcription pipeline never paginated);
 *   - the pre-existing response shape is unchanged, so the documents table
 *     that shipped in #4089 keeps working;
 *   - pagination still bounds rows while `total` counts the whole KB.
 *
 * getDb() is replaced with an in-memory fake supporting only the query
 * shapes this action uses (count, and a left-joined paginated select).
 * Auth, S3, and the manifest-intent helpers are stubbed — none are
 * exercised by listManifest.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  kbs: [] as Record<string, unknown>[],
  tenants: [] as Record<string, unknown>[],
  sources: [] as Record<string, unknown>[],
  docs: [] as Record<string, unknown>[],
}));

// Where-conditions are approximated the same way knowledge-base-manager.test.ts
// does it: pull bound param values out of the SQL AST and keep rows whose field
// values contain all of them. Exact enough for single-KB fixtures with unique
// ids.
function condValues(cond: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if ("value" in node && node.constructor?.name === "Param") {
      out.push(node.value);
      return;
    }
    if (Array.isArray(node.queryChunks)) node.queryChunks.forEach(walk);
    if (Array.isArray(node)) node.forEach(walk);
  };
  walk(cond);
  return out;
}

function rowMatches(row: Record<string, unknown>, cond: unknown): boolean {
  const values = condValues(cond);
  if (values.length === 0) return true;
  const fields = Object.values(row);
  return values.every((value) => fields.includes(value));
}

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  const schema = await import("@thinkwork/database-pg/schema");

  const tableRows = (table: unknown): Record<string, unknown>[] => {
    if (table === schema.knowledgeBases) return h.kbs;
    if (table === schema.tenants) return h.tenants;
    if (table === schema.knowledgeBaseSources) return h.sources;
    if (table === schema.knowledgeBaseDocuments) return h.docs;
    return [];
  };

  // A projection of exactly {value} is the count() query; anything else is a
  // column projection resolved by each drizzle column's `.name`.
  const isCount = (projection: any) =>
    projection &&
    Object.keys(projection).length === 1 &&
    Object.keys(projection)[0] === "value";

  const project = (
    projection: any,
    row: Record<string, unknown>,
    joined: Record<string, unknown> | undefined,
  ) => {
    const out: Record<string, unknown> = {};
    for (const [alias, column] of Object.entries<any>(projection ?? {})) {
      const name = column?.name ?? alias;
      out[alias] =
        name in row ? row[name] : joined ? (joined[name] ?? null) : null;
    }
    return out;
  };

  const db = {
    select: (projection?: any) => ({
      from: (table: unknown) => {
        let joinTable: unknown = null;
        let rows = () => tableRows(table);
        let cond: unknown = undefined;
        let take: number | null = null;
        let skip = 0;

        const resolve = () => {
          const matched = rows().filter((row) => rowMatches(row, cond));
          if (isCount(projection)) {
            return [{ value: matched.length }];
          }
          const joinRows = joinTable ? tableRows(joinTable) : [];
          const projected = matched.map((row) =>
            project(
              projection,
              row,
              joinRows.find((candidate) => candidate.id === row.source_id),
            ),
          );
          const start = skip;
          const end = take === null ? undefined : skip + take;
          return projected.slice(start, end);
        };

        const builder: any = {
          leftJoin: (table2: unknown) => {
            joinTable = table2;
            return builder;
          },
          where: (condition?: unknown) => {
            cond = condition;
            return builder;
          },
          orderBy: () => builder,
          limit: (n: number) => {
            take = n;
            return builder;
          },
          offset: (n: number) => {
            skip = n;
            return builder;
          },
          then: (onOk: any, onErr: any) =>
            Promise.resolve(resolve()).then(onOk, onErr),
        };
        return builder;
      },
    }),
    insert: () => ({ values: () => Promise.resolve() }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: () => ({ where: () => Promise.resolve() }),
    execute: () => Promise.resolve(),
  };

  return { ...actual, getDb: () => db };
});

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: (key: string, fallback = "") =>
    key === "WORKSPACE_BUCKET" ? "workspace-bucket" : fallback,
}));

vi.mock("./src/lib/cognito-auth.js", () => ({
  authenticate: async () => ({ authType: "cognito", sub: "user-1" }),
}));

vi.mock("./src/graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: async () => ({ tenantId: "tenant-1" }),
}));

vi.mock("./src/lib/knowledge/kb-document-manifest.js", () => ({
  stampDocumentDeleteIntent: async () => {},
  stampDocumentUploadIntent: async () => {},
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Cmd {
    constructor(public input: unknown) {}
  }
  return {
    S3Client: class {
      async send() {
        return {};
      }
    },
    DeleteObjectCommand: Cmd,
    GetObjectCommand: Cmd,
    ListObjectsV2Command: Cmd,
    PutObjectCommand: Cmd,
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async () => "https://example.invalid/presigned",
}));

const { handler } = await import("./knowledge-base-files.js");

const KB_ID = "kb-1";
const CONNECTED_SOURCE_ID = "source-connected";

function listManifest(body: Record<string, unknown> = {}) {
  return handler({
    headers: { authorization: "Bearer token" },
    body: JSON.stringify({ action: "listManifest", kbId: KB_ID, ...body }),
  });
}

function parse(result: { statusCode: number; body: string }) {
  return JSON.parse(result.body);
}

function seedDocument(overrides: Record<string, unknown> = {}) {
  const row = {
    id: `doc-${h.docs.length + 1}`,
    tenant_id: "tenant-1",
    knowledge_base_id: KB_ID,
    source_id: CONNECTED_SOURCE_ID,
    document_key: `cx/CX-${String(h.docs.length + 1).padStart(4, "0")}.pdf`,
    ingest_status: "indexed",
    projection_status: "projected",
    edition: 1,
    page_count: 4,
    last_error: null,
    effective_from: new Date("2026-07-20T00:00:00.000Z"),
    updated_at: new Date("2026-07-25T00:00:00.000Z"),
    ...overrides,
  };
  h.docs.push(row);
  return row;
}

beforeEach(() => {
  h.kbs.length = 0;
  h.tenants.length = 0;
  h.sources.length = 0;
  h.docs.length = 0;
  h.kbs.push({ id: KB_ID, tenant_id: "tenant-1", slug: "cx-sops" });
  h.tenants.push({ id: "tenant-1", slug: "mcpherson" });
  h.sources.push({
    id: CONNECTED_SOURCE_ID,
    knowledge_base_id: KB_ID,
    kind: "s3-connect",
  });
});

describe("listManifest field widening (THINK-345 U1)", () => {
  it("round-trips every widened field", async () => {
    seedDocument({
      document_key: "cx/CX-0215 Setting Up New Reason Code.pdf",
      ingest_status: "indexed",
      projection_status: "projected",
      edition: 3,
      page_count: 1,
      last_error: null,
    });

    const body = parse(await listManifest());
    expect(body.ok).toBe(true);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]).toMatchObject({
      name: "CX-0215 Setting Up New Reason Code.pdf",
      documentKey: "cx/CX-0215 Setting Up New Reason Code.pdf",
      status: "indexed",
      projectionStatus: "projected",
      edition: 3,
      pageCount: 1,
      lastError: null,
      effectiveFrom: "2026-07-20T00:00:00.000Z",
    });
  });

  it("returns nulls rather than omitting keys when the fields are empty", async () => {
    seedDocument({
      projection_status: null,
      edition: null,
      page_count: null,
      last_error: null,
      effective_from: null,
    });

    const [doc] = parse(await listManifest()).documents;
    // The rail renders these as labelled rows, so the keys must exist even
    // when unset — `undefined` would collapse them silently.
    for (const key of [
      "projectionStatus",
      "edition",
      "pageCount",
      "lastError",
      "effectiveFrom",
    ]) {
      expect(doc).toHaveProperty(key);
      expect(doc[key]).toBeNull();
    }
  });

  it("surfaces the recorded error for a failed document", async () => {
    seedDocument({
      ingest_status: "failed",
      last_error: "Bedrock ingestion returned an empty statusReason",
      page_count: null,
    });

    const [doc] = parse(await listManifest()).documents;
    expect(doc.status).toBe("failed");
    expect(doc.lastError).toBe(
      "Bedrock ingestion returned an empty statusReason",
    );
  });

  it("keeps the pre-existing response shape unchanged", async () => {
    seedDocument({ document_key: "cx/CX-0001.pdf" });

    const [doc] = parse(await listManifest()).documents;
    expect(doc.id).toBe("doc-1");
    expect(doc.documentKey).toBe("cx/CX-0001.pdf");
    expect(doc.name).toBe("CX-0001.pdf");
    expect(doc.status).toBe("indexed");
    expect(doc.sourceKind).toBe("s3-connect");
    expect(doc.updatedAt).toBe("2026-07-25T00:00:00.000Z");
  });

  it("still reports managed-upload for a document with no source row", async () => {
    seedDocument({ source_id: null });

    const [doc] = parse(await listManifest()).documents;
    expect(doc.sourceKind).toBe("managed-upload");
  });
});

describe("listManifest pagination", () => {
  it("bounds rows by limit and offset while total counts the whole KB", async () => {
    for (let i = 0; i < 5; i++) seedDocument();

    const body = parse(await listManifest({ limit: 2, offset: 1 }));
    expect(body.total).toBe(5);
    expect(body.documents).toHaveLength(2);
    expect(body.documents[0].id).toBe("doc-2");
    expect(body.documents[1].id).toBe("doc-3");
  });
});
