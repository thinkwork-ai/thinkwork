/**
 * KB document manifest tests (THINK-193 U7): reconcile idempotency,
 * edition bumping on etag change, delete intent for removed objects,
 * Hindsight retraction chaining, and the two-probe deletion settlement
 * gate (Bedrock absent AND scoped Retrieve empty).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  ...(await import("../memory-sources/test-support/drizzle-condition-mocks.js"))
    .drizzleConditionMocks,
}));
vi.mock("../memory-sources/retraction.js", () => ({
  enqueueDerivationRetraction: vi.fn(),
}));

import type { Database } from "@thinkwork/database-pg";
import {
  knowledgeBaseDocuments,
  memoryDerivations,
  memorySourceConfigs,
} from "@thinkwork/database-pg/schema";

import { enqueueDerivationRetraction } from "../memory-sources/retraction.js";
import {
  matches,
  type FakeCond,
} from "../memory-sources/test-support/fake-claims-db.js";
import { kbDocumentProjectionKey } from "../memory-sources/adapters/bedrock-kb.js";
import {
  bedrockDocStatusToIngestStatus,
  enqueueManifestRetractions,
  normalizeManifestEtag,
  reconcileKnowledgeBaseDocuments,
  settleDeletedDocuments,
  stampDocumentDeleteIntent,
  stampDocumentUploadIntent,
  type KbManifestRow,
} from "./kb-document-manifest.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const KB_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_CONFIG_ID = "11111111-1111-4111-8111-111111111111";
const DS_ID = "DSABC12345";
const KEY_A = "tenants/acme/knowledge-bases/policies/documents/travel.md";
const KEY_B = "tenants/acme/knowledge-bases/policies/documents/expenses.md";

type Row = Record<string, unknown>;

interface ManifestStore {
  docs: Row[];
  sourceConfigs: Row[];
  derivations: Row[];
}

let idCounter = 0;

/** Tiny in-memory drizzle fake over the three tables the manifest module
 * touches; conditions are the descriptor objects from
 * drizzle-condition-mocks, interpreted by fake-claims-db's matches(). */
function makeManifestDb(store: ManifestStore): Database {
  const rowsFor = (table: unknown): Row[] => {
    if (table === knowledgeBaseDocuments) return store.docs;
    if (table === memorySourceConfigs) return store.sourceConfigs;
    if (table === memoryDerivations) return store.derivations;
    throw new Error("unexpected table");
  };
  const project = (rows: Row[], fields?: Record<string, { name: string }>) =>
    fields
      ? rows.map((row) =>
          Object.fromEntries(
            Object.entries(fields).map(([alias, col]) => [
              alias,
              row[col.name],
            ]),
          ),
        )
      : rows.map((row) => ({ ...row }));

  return {
    select(fields?: Record<string, { name: string }>) {
      return {
        from(table: unknown) {
          const result = (cond?: FakeCond) =>
            project(
              rowsFor(table).filter((row) => matches(row, cond)),
              fields,
            );
          return {
            where(cond: FakeCond) {
              const rows = result(cond);
              return {
                then: (
                  resolve: (rows: Row[]) => unknown,
                  reject: (err: unknown) => unknown,
                ) => Promise.resolve(rows).then(resolve, reject),
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values: async (value: Row) => {
          rowsFor(table).push({
            id: `row-${(idCounter += 1)}`,
            created_at: new Date(),
            last_error: null,
            s3_version_id: null,
            ...value,
          });
        },
      };
    },
    update(table: unknown) {
      return {
        set(patch: Row) {
          return {
            where: async (cond: FakeCond) => {
              for (const row of rowsFor(table)) {
                if (matches(row, cond)) Object.assign(row, patch);
              }
              return [];
            },
          };
        },
      };
    },
  } as unknown as Database;
}

const T0 = new Date("2026-07-01T00:00:00.000Z");
const T1 = new Date("2026-07-10T00:00:00.000Z");
const T2 = new Date("2026-07-12T00:00:00.000Z");

type ReconcileArgs = Parameters<typeof reconcileKnowledgeBaseDocuments>[1];

function reconcileArgs(
  store: ManifestStore,
  overrides: Partial<ReconcileArgs> = {},
): [Database, ReconcileArgs] {
  return [
    makeManifestDb(store),
    {
      tenantId: TENANT_ID,
      knowledgeBaseId: KB_ID,
      dataSourceId: DS_ID,
      s3Objects: [{ key: KEY_A, etag: "etag-a1", versionId: "v1" }],
      bedrockStatusByKey: new Map([[KEY_A, "INDEXED"]]),
      now: T1,
      ...overrides,
    },
  ];
}

describe("helpers", () => {
  it("normalizes quoted etags", () => {
    expect(normalizeManifestEtag('"abc123"')).toBe("abc123");
    expect(normalizeManifestEtag(null)).toBeNull();
    expect(normalizeManifestEtag('""')).toBeNull();
  });

  it("maps Bedrock document statuses onto the manifest domain", () => {
    expect(bedrockDocStatusToIngestStatus("INDEXED")).toBe("indexed");
    expect(bedrockDocStatusToIngestStatus("PARTIALLY_INDEXED")).toBe("indexed");
    expect(bedrockDocStatusToIngestStatus("FAILED")).toBe("failed");
    expect(bedrockDocStatusToIngestStatus("NOT_FOUND")).toBe("pending");
    expect(bedrockDocStatusToIngestStatus(undefined)).toBe("pending");
    expect(bedrockDocStatusToIngestStatus("IN_PROGRESS")).toBe("ingesting");
  });
});

describe("reconcileKnowledgeBaseDocuments", () => {
  it("creates edition-1 rows for new objects", async () => {
    const store: ManifestStore = {
      docs: [],
      sourceConfigs: [],
      derivations: [],
    };
    const result = await reconcileKnowledgeBaseDocuments(
      ...reconcileArgs(store),
    );
    expect(result.created).toBe(1);
    expect(store.docs).toHaveLength(1);
    expect(store.docs[0]).toMatchObject({
      document_key: KEY_A,
      edition: 1,
      etag: "etag-a1",
      s3_version_id: "v1",
      ingest_status: "indexed",
      projection_status: "pending",
      effective_from: T1,
      effective_to: null,
    });
  });

  it("is idempotent: replaying the same inputs touches nothing", async () => {
    const store: ManifestStore = {
      docs: [],
      sourceConfigs: [],
      derivations: [],
    };
    await reconcileKnowledgeBaseDocuments(...reconcileArgs(store));
    const frozen = JSON.stringify(store.docs);
    const second = await reconcileKnowledgeBaseDocuments(
      ...reconcileArgs(store, { now: T2 }),
    );
    expect(second).toMatchObject({
      created: 0,
      editionsBumped: 0,
      statusUpdated: 0,
      unchanged: 1,
    });
    // Same rows byte-for-byte — updated_at was NOT bumped, so the adapter
    // cursor does not re-project an unchanged document.
    expect(JSON.stringify(store.docs)).toBe(frozen);
  });

  it("bumps the edition in place on a changed etag and re-opens the interval", async () => {
    const store: ManifestStore = {
      docs: [],
      sourceConfigs: [],
      derivations: [],
    };
    await reconcileKnowledgeBaseDocuments(...reconcileArgs(store));
    const rowId = store.docs[0]!.id;
    const result = await reconcileKnowledgeBaseDocuments(
      ...reconcileArgs(store, {
        s3Objects: [{ key: KEY_A, etag: "etag-a2", versionId: "v2" }],
        now: T2,
      }),
    );
    expect(result.editionsBumped).toBe(1);
    expect(store.docs).toHaveLength(1); // same row — stable manifest id
    expect(store.docs[0]).toMatchObject({
      id: rowId,
      edition: 2,
      etag: "etag-a2",
      s3_version_id: "v2",
      effective_from: T2,
      effective_to: null,
      projection_status: "pending",
      updated_at: T2,
    });
  });

  it("marks S3-removed documents 'deleting' and reports them for retraction", async () => {
    const store: ManifestStore = {
      docs: [],
      sourceConfigs: [],
      derivations: [],
    };
    await reconcileKnowledgeBaseDocuments(...reconcileArgs(store));
    store.docs[0]!.projection_status = "projected";
    const result = await reconcileKnowledgeBaseDocuments(
      ...reconcileArgs(store, {
        s3Objects: [],
        bedrockStatusByKey: new Map(),
        now: T2,
      }),
    );
    expect(store.docs[0]!.ingest_status).toBe("deleting");
    expect(result.deletingNeedingRetraction.map((r) => r.document_key)).toEqual(
      [KEY_A],
    );
    // absent_verified rows are settled — never re-marked.
    store.docs[0]!.ingest_status = "absent_verified";
    store.docs[0]!.projection_status = "retracted";
    const again = await reconcileKnowledgeBaseDocuments(
      ...reconcileArgs(store, {
        s3Objects: [],
        bedrockStatusByKey: new Map(),
        now: T2,
      }),
    );
    expect(store.docs[0]!.ingest_status).toBe("absent_verified");
    expect(again.deletingNeedingRetraction).toEqual([]);
  });

  it("includes files-handler-stamped 'deleting' rows in the retraction set", async () => {
    const store: ManifestStore = {
      docs: [],
      sourceConfigs: [],
      derivations: [],
    };
    await reconcileKnowledgeBaseDocuments(...reconcileArgs(store));
    const db = makeManifestDb(store);
    await stampDocumentDeleteIntent(db, {
      knowledgeBaseId: KB_ID,
      documentKey: KEY_A,
      now: T2,
    });
    expect(store.docs[0]!.ingest_status).toBe("deleting");
    const result = await reconcileKnowledgeBaseDocuments(
      ...reconcileArgs(store, {
        s3Objects: [],
        bedrockStatusByKey: new Map(),
        now: T2,
      }),
    );
    expect(result.deletingNeedingRetraction).toHaveLength(1);
  });

  it("a re-uploaded identical object resurrects a 'deleting' row", async () => {
    const store: ManifestStore = {
      docs: [],
      sourceConfigs: [],
      derivations: [],
    };
    await reconcileKnowledgeBaseDocuments(...reconcileArgs(store));
    store.docs[0]!.ingest_status = "deleting";
    const result = await reconcileKnowledgeBaseDocuments(
      ...reconcileArgs(store, { now: T2 }),
    );
    expect(result.statusUpdated).toBe(1);
    expect(store.docs[0]!.ingest_status).toBe("indexed");
    expect(store.docs[0]!.effective_to).toBeNull();
  });

  it("upload intent stamps pending without bumping the edition", async () => {
    const store: ManifestStore = {
      docs: [],
      sourceConfigs: [],
      derivations: [],
    };
    await reconcileKnowledgeBaseDocuments(...reconcileArgs(store));
    await stampDocumentUploadIntent(makeManifestDb(store), {
      knowledgeBaseId: KB_ID,
      documentKey: KEY_A,
      now: T2,
    });
    expect(store.docs[0]).toMatchObject({
      ingest_status: "pending",
      edition: 1,
    });
  });
});

describe("enqueueManifestRetractions", () => {
  beforeEach(() => {
    vi.mocked(enqueueDerivationRetraction).mockReset();
    vi.mocked(enqueueDerivationRetraction).mockResolvedValue({
      id: "attempt-1",
    } as never);
  });

  function deletingRow(key: string): KbManifestRow {
    return {
      id: "doc-1",
      tenant_id: TENANT_ID,
      knowledge_base_id: KB_ID,
      data_source_id: DS_ID,
      document_key: key,
      ingest_status: "deleting",
      projection_status: "projected",
    } as unknown as KbManifestRow;
  }

  it("chains the standard Hindsight retraction for projected documents", async () => {
    const store: ManifestStore = {
      docs: [deletingRow(KEY_A) as unknown as Row],
      sourceConfigs: [
        {
          id: SOURCE_CONFIG_ID,
          tenant_id: TENANT_ID,
          source_family: "bedrock_kb",
          source_binding_key: KB_ID,
        },
      ],
      derivations: [
        {
          id: "deriv-1",
          tenant_id: TENANT_ID,
          source_config_id: SOURCE_CONFIG_ID,
          projection_key: kbDocumentProjectionKey(KEY_A),
          lifecycle: "active",
        },
      ],
    };
    const db = makeManifestDb(store);
    const result = await enqueueManifestRetractions(db, {
      tenantId: TENANT_ID,
      knowledgeBaseId: KB_ID,
      rows: [deletingRow(KEY_A)],
    });
    expect(result.enqueued).toBe(1);
    expect(enqueueDerivationRetraction).toHaveBeenCalledWith(db, {
      tenantId: TENANT_ID,
      derivationId: "deriv-1",
    });
    expect(store.docs[0]!.projection_status).toBe("retracting");
  });

  it("marks never-projected documents 'retracted' without enqueueing", async () => {
    const store: ManifestStore = {
      docs: [deletingRow(KEY_B) as unknown as Row],
      sourceConfigs: [],
      derivations: [],
    };
    const result = await enqueueManifestRetractions(makeManifestDb(store), {
      tenantId: TENANT_ID,
      knowledgeBaseId: KB_ID,
      rows: [deletingRow(KEY_B)],
    });
    expect(result.enqueued).toBe(0);
    expect(enqueueDerivationRetraction).not.toHaveBeenCalled();
    expect(store.docs[0]!.projection_status).toBe("retracted");
  });
});

describe("settleDeletedDocuments (two-probe gate)", () => {
  function storeWithDeleting(): ManifestStore {
    return {
      docs: [
        {
          id: "doc-1",
          tenant_id: TENANT_ID,
          knowledge_base_id: KB_ID,
          data_source_id: DS_ID,
          document_key: KEY_A,
          ingest_status: "deleting",
          projection_status: "retracting",
          effective_to: null,
          last_error: null,
        },
      ],
      sourceConfigs: [],
      derivations: [],
    };
  }

  it("settles ONLY when Bedrock reports absent AND Retrieve has no residue", async () => {
    const store = storeWithDeleting();
    const settle = (absent: boolean, residue: boolean) =>
      settleDeletedDocuments(makeManifestDb(store), {
        tenantId: TENANT_ID,
        knowledgeBaseId: KB_ID,
        dataSourceId: DS_ID,
        now: T2,
        probes: {
          isDocumentAbsent: async () => absent,
          retrieveHasResidue: async () => residue,
        },
      });

    // Still present in Bedrock: unsettled.
    expect(await settle(false, false)).toEqual({ settled: 0, pending: 1 });
    expect(store.docs[0]!.ingest_status).toBe("deleting");
    // Absent but Retrieve still returns hits: unsettled (index residue).
    expect(await settle(true, true)).toEqual({ settled: 0, pending: 1 });
    expect(store.docs[0]!.ingest_status).toBe("deleting");
    // Both gates pass: absent_verified, interval closed.
    expect(await settle(true, false)).toEqual({ settled: 1, pending: 0 });
    expect(store.docs[0]).toMatchObject({
      ingest_status: "absent_verified",
      effective_to: T2,
      last_error: null,
    });
  });

  it("a probe failure leaves the row 'deleting' with a visible last_error (retried next sync)", async () => {
    const store = storeWithDeleting();
    const result = await settleDeletedDocuments(makeManifestDb(store), {
      tenantId: TENANT_ID,
      knowledgeBaseId: KB_ID,
      dataSourceId: DS_ID,
      now: T2,
      probes: {
        isDocumentAbsent: async () => {
          throw new Error("bedrock throttled");
        },
        retrieveHasResidue: async () => false,
      },
    });
    expect(result).toEqual({ settled: 0, pending: 1 });
    expect(store.docs[0]!.ingest_status).toBe("deleting");
    expect(store.docs[0]!.last_error).toContain("bedrock throttled");
  });
});
