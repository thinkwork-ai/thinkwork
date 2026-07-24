/**
 * knowledge-base-manager tests (external S3 KB source U2) — the module's
 * first suite.
 *
 * getDb() is replaced with an in-memory table fake; every AWS SDK module the
 * manager dynamically imports is mocked with command-recording clients.
 * Manifest reconciliation/settlement are stubbed (their logic has its own
 * suite) — these tests pin the manager's orchestration:
 *
 *   - characterization: managed-upload provisioning issues the same Bedrock
 *     calls as before the sources refactor (S3 crawler config, chunking);
 *   - s3-connect sources provision as CUSTOM data sources and sync by
 *     direct ingestion against the customer bucket (point, don't copy);
 *   - AE6: foreign bucket-owner account rejected before any AWS call;
 *   - sync skips access_revoked sources but still syncs healthy siblings;
 *   - delete tears down every data source of a multi-source KB.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    kbs: [] as Record<string, unknown>[],
    sources: [] as Record<string, unknown>[],
    docs: [] as Record<string, unknown>[],
    tenants: [] as Record<string, unknown>[],
    agentKbs: [] as Record<string, unknown>[],
    sent: [] as { client: string; command: string; input: any }[],
    s3Objects: [] as { Key: string; ETag: string; Size: number }[],
    ingestionJobStatus: "COMPLETE" as string,
    docStatuses: new Map<string, string>(),
    retrieveResults: [] as any[],
    assumeRoleFails: false,
    listAsRoleFails: false,
    nextSourceId: 1,
  };
  return state;
});

// ---------------------------------------------------------------------------
// DB fake: routes drizzle table objects to in-memory arrays. Where-conditions
// are approximated by extracting bound param values from the SQL AST and
// keeping rows where every param value appears among the row's field values —
// exact enough for single-KB fixtures with unique ids.
// ---------------------------------------------------------------------------

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
    if (table === schema.knowledgeBaseSources) return h.sources;
    if (table === schema.knowledgeBaseDocuments) return h.docs;
    if (table === schema.tenants) return h.tenants;
    if (table === schema.agentKnowledgeBases) return h.agentKbs;
    return [];
  };

  const db = {
    select: (_projection?: unknown) => ({
      from: (table: unknown) => {
        const filter = (cond?: unknown) =>
          tableRows(table).filter((row) => rowMatches(row, cond));
        const builder = {
          where: (cond?: unknown) => {
            const rows = filter(cond);
            const whereBuilder = {
              orderBy: () => Promise.resolve(rows),
              then: (resolve: any, reject: any) =>
                Promise.resolve(rows).then(resolve, reject),
            };
            return whereBuilder;
          },
          orderBy: () => Promise.resolve(filter()),
          then: (resolve: any, reject: any) =>
            Promise.resolve(filter()).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const row = {
          id: `row-${h.nextSourceId++}`,
          created_at: new Date(),
          updated_at: new Date(),
          aws_data_source_id: null,
          bucket: null,
          prefix: null,
          filter_patterns: null,
          bucket_owner_account_id: null,
          sentinel_document_key: null,
          sentinel_phrase: null,
          document_count: 0,
          last_sync_at: null,
          last_sync_status: null,
          error_message: null,
          ...values,
        };
        tableRows(table).push(row);
        return {
          returning: () => Promise.resolve([row]),
          then: (resolve: any, reject: any) =>
            Promise.resolve([row]).then(resolve, reject),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          for (const row of tableRows(table)) {
            if (rowMatches(row, cond)) Object.assign(row, values);
          }
          return Promise.resolve();
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const rows = tableRows(table);
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rowMatches(rows[i], cond)) rows.splice(i, 1);
        }
        return Promise.resolve();
      },
    }),
    execute: () => Promise.resolve(),
  };

  return { ...actual, getDb: () => db };
});

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: (key: string, fallback = "") =>
    key === "WORKSPACE_BUCKET"
      ? "workspace-bucket"
      : key === "DATABASE_SECRET_ARN"
        ? "arn:aws:secretsmanager:us-east-1:111111111111:secret:db"
        : fallback,
}));

// ---------------------------------------------------------------------------
// AWS SDK fakes — every client records {client, command, input} into h.sent.
// ---------------------------------------------------------------------------

function commandClass(name: string) {
  return class {
    static commandName = name;
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  };
}

vi.mock("@aws-sdk/client-bedrock-agent", () => {
  const commands = [
    "CreateKnowledgeBaseCommand",
    "CreateDataSourceCommand",
    "DeleteDataSourceCommand",
    "DeleteKnowledgeBaseCommand",
    "StartIngestionJobCommand",
    "GetIngestionJobCommand",
    "IngestKnowledgeBaseDocumentsCommand",
    "DeleteKnowledgeBaseDocumentsCommand",
    "ListKnowledgeBaseDocumentsCommand",
    "GetKnowledgeBaseDocumentsCommand",
  ];
  const exported: Record<string, unknown> = {};
  for (const name of commands) exported[name] = commandClass(name);
  exported.BedrockAgentClient = class {
    async send(command: any) {
      const name = command.constructor.commandName;
      h.sent.push({
        client: "bedrock-agent",
        command: name,
        input: command.input,
      });
      switch (name) {
        case "CreateKnowledgeBaseCommand":
          return { knowledgeBase: { knowledgeBaseId: "AWSKB123" } };
        case "CreateDataSourceCommand":
          return {
            dataSource: { dataSourceId: `DS-${h.sent.length}` },
          };
        case "StartIngestionJobCommand":
          return { ingestionJob: { ingestionJobId: "JOB1" } };
        case "GetIngestionJobCommand":
          return {
            ingestionJob: {
              status: h.ingestionJobStatus,
              statistics: { numberOfDocumentsScanned: 5 },
            },
          };
        case "ListKnowledgeBaseDocumentsCommand":
          return {
            documentDetails: [...h.docStatuses.entries()].map(
              ([id, status]) => ({ identifier: { custom: { id } }, status }),
            ),
          };
        default:
          return {};
      }
    }
  };
  return exported;
});

vi.mock("@aws-sdk/client-s3", () => {
  const commands = [
    "ListObjectsV2Command",
    "GetObjectCommand",
    "HeadObjectCommand",
    "DeleteObjectsCommand",
  ];
  const exported: Record<string, unknown> = {};
  for (const name of commands) exported[name] = commandClass(name);
  exported.S3Client = class {
    constructor(readonly config: any) {}
    async send(command: any) {
      const name = command.constructor.commandName;
      h.sent.push({ client: "s3", command: name, input: command.input });
      if (name === "ListObjectsV2Command") {
        if (this.config?.credentials && h.listAsRoleFails) {
          throw new Error("AccessDenied");
        }
        return { Contents: h.s3Objects, IsTruncated: false };
      }
      if (name === "GetObjectCommand") {
        return { Body: { transformToByteArray: async () => new Uint8Array() } };
      }
      return {};
    }
  };
  return exported;
});

vi.mock("@aws-sdk/client-bedrock-agent-runtime", () => {
  const exported: Record<string, unknown> = {
    RetrieveCommand: commandClass("RetrieveCommand"),
  };
  exported.BedrockAgentRuntimeClient = class {
    async send(command: any) {
      h.sent.push({
        client: "bedrock-agent-runtime",
        command: command.constructor.commandName,
        input: command.input,
      });
      return { retrievalResults: h.retrieveResults };
    }
  };
  return exported;
});

vi.mock("@aws-sdk/client-sts", () => {
  const exported: Record<string, unknown> = {
    AssumeRoleCommand: commandClass("AssumeRoleCommand"),
  };
  exported.STSClient = class {
    async send(command: any) {
      h.sent.push({
        client: "sts",
        command: command.constructor.commandName,
        input: command.input,
      });
      if (h.assumeRoleFails) throw new Error("AccessDenied on AssumeRole");
      return {
        Credentials: {
          AccessKeyId: "AKIA",
          SecretAccessKey: "secret",
          SessionToken: "token",
        },
      };
    }
  };
  return exported;
});

vi.mock(
  "./src/lib/knowledge/kb-document-manifest.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("./src/lib/knowledge/kb-document-manifest.js")
      >();
    return {
      ...actual,
      reconcileKnowledgeBaseDocuments: vi.fn(async () => ({
        created: 0,
        editionsBumped: 0,
        statusUpdated: 0,
        unchanged: 0,
        deletingNeedingRetraction: [],
      })),
      settleDeletedDocuments: vi.fn(async () => ({ settled: 0, pending: 0 })),
      enqueueManifestRetractions: vi.fn(async () => ({ enqueued: 0 })),
    };
  },
);

process.env.KB_SERVICE_ROLE_ARN =
  "arn:aws:iam::111111111111:role/thinkwork-dev-kb-service-role";
process.env.DATABASE_CLUSTER_ARN =
  "arn:aws:rds:us-east-1:111111111111:cluster:dev";

// eslint-disable-next-line import/first
import { handler } from "./knowledge-base-manager.js";

const TENANT = { id: "tenant-1", slug: "acme" };

function seedKb(overrides: Record<string, unknown> = {}) {
  const kb = {
    id: "kb-1",
    tenant_id: TENANT.id,
    name: "Test KB",
    slug: "test-kb",
    embedding_model: "amazon.titan-embed-text-v2:0",
    chunking_strategy: "FIXED_SIZE",
    chunk_size_tokens: 300,
    chunk_overlap_percent: 20,
    status: "creating",
    aws_kb_id: null,
    aws_data_source_id: null,
    document_count: 0,
    ...overrides,
  };
  h.kbs.push(kb);
  return kb;
}

function seedSource(overrides: Record<string, unknown> = {}) {
  const source = {
    id: `src-${h.nextSourceId++}`,
    tenant_id: TENANT.id,
    knowledge_base_id: "kb-1",
    kind: "managed-upload",
    bucket: null,
    prefix: "tenants/acme/knowledge-bases/test-kb/documents/",
    filter_patterns: null,
    bucket_owner_account_id: null,
    parsing_strategy: "DEFAULT",
    aws_data_source_id: "DS-EXISTING",
    access_status: "healthy",
    last_sync_at: null,
    last_sync_status: null,
    document_count: 0,
    error_message: null,
    sentinel_document_key: null,
    sentinel_phrase: null,
    created_at: new Date("2026-01-01"),
    updated_at: new Date("2026-01-01"),
    ...overrides,
  };
  h.sources.push(source);
  return source;
}

/** Drive the handler's poll-sleeps: advance fake time until it settles. */
async function runWithTimers(promise: Promise<unknown>) {
  let done = false;
  const guarded = promise.finally(() => {
    done = true;
  });
  for (let i = 0; i < 200 && !done; i++) {
    await vi.advanceTimersByTimeAsync(10_000);
  }
  return guarded;
}

beforeEach(() => {
  h.kbs.length = 0;
  h.sources.length = 0;
  h.docs.length = 0;
  h.agentKbs.length = 0;
  h.tenants.length = 0;
  h.tenants.push(TENANT);
  h.sent.length = 0;
  h.s3Objects.length = 0;
  h.docStatuses.clear();
  h.retrieveResults = [];
  h.ingestionJobStatus = "COMPLETE";
  h.assumeRoleFails = false;
  h.listAsRoleFails = false;
  vi.useFakeTimers();
  return () => vi.useRealTimers();
});

function sent(client: string, command: string) {
  return h.sent.filter(
    (entry) => entry.client === client && entry.command === command,
  );
}

describe("create — characterization of the managed-upload path", () => {
  it("provisions a single managed-upload KB with the same Bedrock calls as before the refactor", async () => {
    seedKb();
    // A fresh KB has no source rows yet — create must self-provision #0.
    await handler({ action: "create", knowledgeBaseId: "kb-1" });

    const createKb = sent("bedrock-agent", "CreateKnowledgeBaseCommand");
    expect(createKb).toHaveLength(1);
    expect(createKb[0].input.name).toBe("thinkwork-acme-test-kb-kb-1");

    const createDs = sent("bedrock-agent", "CreateDataSourceCommand");
    expect(createDs).toHaveLength(1);
    expect(createDs[0].input.name).toBe("test-kb-s3");
    expect(createDs[0].input.dataSourceConfiguration).toEqual({
      type: "S3",
      s3Configuration: {
        bucketArn: "arn:aws:s3:::workspace-bucket",
        inclusionPrefixes: ["tenants/acme/knowledge-bases/test-kb/documents/"],
      },
    });
    expect(
      createDs[0].input.vectorIngestionConfiguration.chunkingConfiguration,
    ).toEqual({
      chunkingStrategy: "FIXED_SIZE",
      fixedSizeChunkingConfiguration: { maxTokens: 300, overlapPercentage: 20 },
    });

    const kb = h.kbs[0];
    expect(kb.status).toBe("active");
    expect(kb.aws_kb_id).toBe("AWSKB123");
    expect(kb.aws_data_source_id).toMatch(/^DS-/);
    // The managed-upload source row mirrors the data-source id.
    const source = h.sources.find((row) => row.kind === "managed-upload")!;
    expect(source.aws_data_source_id).toBe(kb.aws_data_source_id);
  });
});

describe("connect_source", () => {
  it("AE6: rejects a foreign bucket-owner account before any AWS call", async () => {
    seedKb({ aws_kb_id: "AWSKB123" });
    seedSource();
    await expect(
      handler({
        action: "connect_source",
        knowledgeBaseId: "kb-1",
        connect: {
          bucket: "cx-to-s3",
          prefix: "cx/files/",
          bucketOwnerAccountId: "999999999999",
        },
      }),
    ).rejects.toThrow(/not yet supported/);
    expect(h.sent).toHaveLength(0);
    expect(h.sources.filter((row) => row.kind === "s3-connect")).toHaveLength(
      0,
    );
  });

  it("AE2: a failed as-role probe blocks the save and names the role", async () => {
    seedKb({ aws_kb_id: "AWSKB123" });
    seedSource();
    h.listAsRoleFails = true;
    h.s3Objects.push({ Key: "cx/files/sop.pdf", ETag: '"e1"', Size: 100 });
    await expect(
      handler({
        action: "connect_source",
        knowledgeBaseId: "kb-1",
        connect: { bucket: "cx-to-s3", prefix: "cx/files/" },
      }),
    ).rejects.toThrow(/thinkwork-dev-kb-service-role.*cannot s3:ListBucket/);
    expect(h.sources.filter((row) => row.kind === "s3-connect")).toHaveLength(
      0,
    );
    expect(sent("bedrock-agent", "CreateDataSourceCommand")).toHaveLength(0);
  });

  it("happy path: preflight as role, source row + CUSTOM data source, sentinel recorded", async () => {
    seedKb({ aws_kb_id: "AWSKB123" });
    seedSource();
    h.s3Objects.push(
      {
        Key: "cx/files/CX-0014 Release Credit Hold.pdf",
        ETag: '"e1"',
        Size: 100,
      },
      { Key: "cx/files/a.pdf", ETag: '"e2"', Size: 100 },
    );

    const result = await handler({
      action: "connect_source",
      knowledgeBaseId: "kb-1",
      connect: {
        bucket: "cx-to-s3",
        prefix: "cx/files/",
        exclude: ["*Retired Procedures/*"],
      },
    });

    expect(sent("sts", "AssumeRoleCommand")).toHaveLength(1);
    const source = h.sources.find((row) => row.kind === "s3-connect")!;
    expect(source.bucket).toBe("cx-to-s3");
    expect(source.filter_patterns).toEqual({
      include: [],
      exclude: ["*Retired Procedures/*"],
    });
    expect(source.aws_data_source_id).toMatch(/^DS-/);
    expect(source.sentinel_document_key).toBe(
      "cx/files/CX-0014 Release Credit Hold.pdf",
    );
    expect(source.sentinel_phrase).toBe("CX 0014 Release Credit Hold");
    const createDs = sent("bedrock-agent", "CreateDataSourceCommand");
    expect(createDs[0].input.dataSourceConfiguration).toEqual({
      type: "CUSTOM",
    });
    expect(result).toMatchObject({ sourceId: source.id });
  });
});

describe("sync — multi-source", () => {
  it("skips access_revoked sources and still syncs healthy siblings", async () => {
    seedKb({ aws_kb_id: "AWSKB123", aws_data_source_id: "DS-EXISTING" });
    seedSource(); // healthy managed-upload
    seedSource({
      id: "src-revoked",
      kind: "s3-connect",
      bucket: "cx-to-s3",
      prefix: "cx/files/",
      aws_data_source_id: "DS-REVOKED",
      access_status: "access_revoked",
    });

    await runWithTimers(handler({ action: "sync", knowledgeBaseId: "kb-1" }));

    // Managed-upload sibling synced via the crawler...
    const start = sent("bedrock-agent", "StartIngestionJobCommand");
    expect(start).toHaveLength(1);
    expect(start[0].input.dataSourceId).toBe("DS-EXISTING");
    // ...and the revoked source's data source saw no traffic at all.
    expect(
      h.sent.filter((entry) => entry.input?.dataSourceId === "DS-REVOKED"),
    ).toHaveLength(0);
    const revoked = h.sources.find((row) => row.id === "src-revoked")!;
    expect(revoked.access_status).toBe("access_revoked");
    expect(h.kbs[0].last_sync_status).toBe("COMPLETE");
  });

  it("s3-connect sync ingests the filtered delta directly from the customer bucket and deletes now-excluded docs", async () => {
    seedKb({ aws_kb_id: "AWSKB123", aws_data_source_id: "DS-EXISTING" });
    seedSource(); // managed-upload sibling (crawler path)
    const source = seedSource({
      kind: "s3-connect",
      bucket: "cx-to-s3",
      prefix: "cx/files/",
      aws_data_source_id: "DS-CONNECT",
      filter_patterns: { include: [], exclude: ["*Retired Procedures/*"] },
      sentinel_document_key: "cx/files/sop-a.pdf",
      sentinel_phrase: "sop a",
    });
    // Manifest knows sop-b at an old etag and retired-doc as indexed.
    h.docs.push(
      {
        id: "doc-b",
        knowledge_base_id: "kb-1",
        data_source_id: "DS-CONNECT",
        document_key: "cx/files/sop-b.pdf",
        etag: "old",
        ingest_status: "indexed",
      },
      {
        id: "doc-retired",
        knowledge_base_id: "kb-1",
        data_source_id: "DS-CONNECT",
        document_key: "cx/files/retired-doc.pdf",
        etag: "e3",
        ingest_status: "indexed",
      },
    );
    h.s3Objects.push(
      { Key: "cx/files/sop-a.pdf", ETag: '"e1"', Size: 100 },
      { Key: "cx/files/sop-b.pdf", ETag: '"e2"', Size: 100 },
      {
        Key: "cx/files/Retired Procedures/retired-doc.pdf",
        ETag: '"e3"',
        Size: 100,
      },
    );
    h.docStatuses.set("cx/files/sop-a.pdf", "INDEXED");
    h.docStatuses.set("cx/files/sop-b.pdf", "INDEXED");
    h.retrieveResults = [
      {
        location: { customDocumentLocation: { id: "cx/files/sop-a.pdf" } },
        content: { text: "..." },
      },
    ];

    await runWithTimers(handler({ action: "sync", knowledgeBaseId: "kb-1" }));

    // No crawler for s3-connect: the only ingestion job targets the
    // managed-upload sibling; the connect source syncs by direct ingestion.
    const start = sent("bedrock-agent", "StartIngestionJobCommand");
    expect(start.map((entry) => entry.input.dataSourceId)).toEqual([
      "DS-EXISTING",
    ]);
    const ingest = sent("bedrock-agent", "IngestKnowledgeBaseDocumentsCommand");
    expect(ingest).toHaveLength(1);
    const uris = ingest[0].input.documents.map(
      (doc: any) => doc.content.custom.s3Location.uri,
    );
    // sop-a is new, sop-b changed etag; the excluded key is never ingested.
    expect(uris.sort()).toEqual([
      "s3://cx-to-s3/cx/files/sop-a.pdf",
      "s3://cx-to-s3/cx/files/sop-b.pdf",
    ]);
    // The doc that moved under Retired Procedures/ is deleted from the index.
    const del = sent("bedrock-agent", "DeleteKnowledgeBaseDocumentsCommand");
    expect(del).toHaveLength(1);
    expect(del[0].input.documentIdentifiers).toEqual([
      { dataSourceType: "CUSTOM", custom: { id: "cx/files/retired-doc.pdf" } },
    ]);
    // Canary passed → healthy.
    const updated = h.sources.find((row) => row.id === source.id)!;
    expect(updated.access_status).toBe("healthy");
    expect(updated.last_sync_status).toBe("COMPLETE");
  });

  it("marks a source degraded when the canary retrieval misses", async () => {
    seedKb({ aws_kb_id: "AWSKB123", aws_data_source_id: "DS-EXISTING" });
    const source = seedSource({
      kind: "s3-connect",
      bucket: "cx-to-s3",
      prefix: "cx/files/",
      aws_data_source_id: "DS-CONNECT",
      sentinel_document_key: "cx/files/sop-a.pdf",
      sentinel_phrase: "sop a",
    });
    h.s3Objects.push({ Key: "cx/files/sop-a.pdf", ETag: '"e1"', Size: 100 });
    h.docStatuses.set("cx/files/sop-a.pdf", "INDEXED");
    h.retrieveResults = []; // canary miss

    await runWithTimers(handler({ action: "sync", knowledgeBaseId: "kb-1" }));

    const updated = h.sources.find((row) => row.id === source.id)!;
    expect(updated.access_status).toBe("degraded");
  });
});

describe("delete — multi-source teardown", () => {
  it("removes every data source of a multi-source KB", async () => {
    seedKb({ aws_kb_id: "AWSKB123", aws_data_source_id: "DS-EXISTING" });
    seedSource();
    seedSource({
      id: "src-2",
      kind: "s3-connect",
      bucket: "cx-to-s3",
      prefix: "cx/files/",
      aws_data_source_id: "DS-CONNECT",
    });

    await handler({ action: "delete", knowledgeBaseId: "kb-1" });

    const deleted = sent("bedrock-agent", "DeleteDataSourceCommand").map(
      (entry) => entry.input.dataSourceId,
    );
    expect(deleted.sort()).toEqual(["DS-CONNECT", "DS-EXISTING"]);
    expect(sent("bedrock-agent", "DeleteKnowledgeBaseCommand")).toHaveLength(1);
    // Customer bucket is never listed or deleted from — only the platform
    // workspace prefix.
    const s3Deletes = sent("s3", "ListObjectsV2Command");
    expect(
      s3Deletes.every((entry) => entry.input.Bucket === "workspace-bucket"),
    ).toBe(true);
    expect(h.kbs).toHaveLength(0);
  });
});
