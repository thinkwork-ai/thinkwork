import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// uploadIdentitySnapshot resolves the bucket from env at call time.
const previousBucket = process.env.BRAIN_ARTIFACTS_BUCKET;
beforeAll(() => {
  process.env.BRAIN_ARTIFACTS_BUCKET = "test-brain-artifacts";
});
afterAll(() => {
  if (previousBucket === undefined) {
    delete process.env.BRAIN_ARTIFACTS_BUCKET;
  } else {
    process.env.BRAIN_ARTIFACTS_BUCKET = previousBucket;
  }
});

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { identityGraphProjectionCursors } from "@thinkwork/database-pg/schema";
import { createFakeIdentityDb } from "./fake-db.test-helper.js";
import {
  BULK_CSV_FILE_NAMES,
  buildBulkLoadCsvFiles,
  bulkRebuildTenantGraph,
  type LoaderStatus,
  type NeptuneLoaderClient,
} from "./bulk-rebuild.js";
import {
  buildCanonicalResyncOps,
  entityNodeId,
  systemEdgeId,
  systemNodeId,
  type GraphOp,
  type MappingRowForSync,
  type NeptuneQueryClient,
} from "./graph-projection.js";

// ---------------------------------------------------------------------------
// Fakes — every seam records into a shared timeline so tests can assert
// cross-seam ordering (clear before upload, upload before start, …).
// ---------------------------------------------------------------------------

class FakeNeptune implements NeptuneQueryClient {
  ops: GraphOp[] = [];
  constructor(private timeline?: string[]) {}
  async execute(query: string, parameters: Record<string, unknown>) {
    this.ops.push({ query, parameters });
    if (query.includes("DETACH DELETE")) this.timeline?.push("clear-batch");
    // The clear loop's count read: report the subgraph empty.
    return { results: [{ c: 0 }] };
  }
}

class FakeLoader implements NeptuneLoaderClient {
  started: Array<{ source: string; iamRoleArn: string; region: string }> = [];
  cancelled: string[] = [];
  statusCalls: Array<{ loadId: string; errors?: boolean }> = [];
  statusQueue: LoaderStatus[] = [];
  constructor(private timeline?: string[]) {}
  async startLoad(args: {
    source: string;
    iamRoleArn: string;
    region: string;
  }) {
    this.started.push(args);
    this.timeline?.push("start-load");
    return { loadId: "load-1" };
  }
  async getStatus(loadId: string, opts?: { errors?: boolean }) {
    this.statusCalls.push({ loadId, errors: opts?.errors });
    return this.statusQueue.shift() ?? { status: "LOAD_COMPLETED" };
  }
  async cancelLoad(loadId: string) {
    this.cancelled.push(loadId);
  }
}

/**
 * Fake S3 covering both staging shapes: a plain PutObject (small files) and
 * the multipart streaming path. `objects` holds the assembled body of every
 * finished object, so tests can compare staged bytes against the in-memory
 * builder's output byte-for-byte.
 */
function makeFakeS3(
  timeline?: string[],
  hooks?: { onUploadPart?: (partNumber: number) => void },
) {
  const puts: Array<{ Bucket?: string; Key?: string; Body?: unknown }> = [];
  const deletes: Array<{ Bucket?: string; Key?: string }> = [];
  const aborts: Array<{ Key?: string; UploadId?: string }> = [];
  const objects = new Map<string, string>();
  const partsByUpload = new Map<string, Map<number, string>>();
  const partCounts = new Map<string, number>();
  let uploadSeq = 0;

  const send = vi.fn(async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      const input = command.input as { Key?: string; Body?: unknown };
      puts.push(command.input as never);
      objects.set(input.Key!, String(input.Body ?? ""));
      timeline?.push(`put:${input.Key}`);
      return {};
    }
    if (command instanceof CreateMultipartUploadCommand) {
      const input = command.input as { Key?: string };
      const uploadId = `upload-${(uploadSeq += 1)}`;
      partsByUpload.set(uploadId, new Map());
      timeline?.push(`mpu-create:${input.Key}`);
      return { UploadId: uploadId };
    }
    if (command instanceof UploadPartCommand) {
      const input = command.input as {
        Key?: string;
        UploadId?: string;
        PartNumber?: number;
        Body?: unknown;
      };
      hooks?.onUploadPart?.(input.PartNumber!);
      partsByUpload
        .get(input.UploadId!)!
        .set(input.PartNumber!, String(input.Body ?? ""));
      partCounts.set(input.Key!, (partCounts.get(input.Key!) ?? 0) + 1);
      timeline?.push(`mpu-part:${input.Key}:${input.PartNumber}`);
      return { ETag: `etag-${input.UploadId}-${input.PartNumber}` };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      const input = command.input as {
        Key?: string;
        UploadId?: string;
        MultipartUpload?: { Parts?: Array<{ PartNumber?: number }> };
      };
      const parts = partsByUpload.get(input.UploadId!)!;
      const ordered = [...(input.MultipartUpload?.Parts ?? [])]
        .sort((a, b) => a.PartNumber! - b.PartNumber!)
        .map((p) => parts.get(p.PartNumber!) ?? "");
      objects.set(input.Key!, ordered.join(""));
      timeline?.push(`put:${input.Key}`);
      return {};
    }
    if (command instanceof AbortMultipartUploadCommand) {
      aborts.push(command.input as never);
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      deletes.push(command.input as never);
      return {};
    }
    return {};
  });
  return {
    s3: { send } as never,
    puts,
    deletes,
    aborts,
    objects,
    partCounts,
    send,
  };
}

const activeCanonical = {
  id: "can-777",
  entity_type_slug: "customer",
  display_name: "777 Automotive",
  status: "active",
  merged_into_id: null,
};

const mergedLoser = {
  id: "can-loser",
  entity_type_slug: "customer",
  display_name: "Old 777",
  status: "merged",
  merged_into_id: "can-777",
};

const twoMappings: MappingRowForSync[] = [
  {
    source_system: "twenty",
    namespace: "",
    external_id: "cmp_889",
    visibility: "tenant",
  },
  {
    source_system: "lastmile",
    namespace: "ns-a",
    external_id: "77-4432",
    visibility: "tenant",
  },
];

function mapOf(entries: Array<[string, MappingRowForSync[]]>) {
  return new Map(entries);
}

// ---------------------------------------------------------------------------
// U1 — openCypher CSV builders (pure)
// ---------------------------------------------------------------------------

describe("buildBulkLoadCsvFiles", () => {
  it("emits entity node, system node, and edge rows with the nudge lane's exact ids", () => {
    const { files, counts } = buildBulkLoadCsvFiles({
      tenantId: "tenant-1",
      canonicals: [activeCanonical],
      mappingsByCanonical: mapOf([["can-777", twoMappings]]),
    });

    expect(counts).toEqual({
      canonicals: 1,
      entityNodes: 1,
      systemNodes: 2,
      externalIdentityEdges: 2,
      mergedLosersSkipped: 0,
    });
    const byName = new Map(files.map((f) => [f.name, f.content]));
    const nodes = byName.get(BULK_CSV_FILE_NAMES.entityNodes)!;
    expect(nodes.split("\n")[0]).toBe(
      ":ID,:LABEL,tenantId:String,canonicalId:String,displayName:String,state:String,mergedInto:String",
    );
    expect(nodes).toContain(
      `${entityNodeId("tenant-1", "can-777")},customer,tenant-1,can-777,777 Automotive,active,`,
    );

    const systems = byName.get(BULK_CSV_FILE_NAMES.systemNodes)!;
    expect(systems).toContain(
      `${systemNodeId("tenant-1", "twenty")},ExternalSystem,tenant-1,twenty`,
    );

    const edges = byName.get(BULK_CSV_FILE_NAMES.edges)!;
    expect(edges.split("\n")[0]).toBe(
      ":ID,:START_ID,:END_ID,:TYPE,tenantId:String,externalId:String,namespace:String",
    );
    expect(edges).toContain(
      [
        systemEdgeId("tenant-1", "can-777", "twenty", ""),
        entityNodeId("tenant-1", "can-777"),
        systemNodeId("tenant-1", "twenty"),
        "external_identity",
        "tenant-1",
        "cmp_889",
        "",
      ].join(","),
    );
    // Namespaced edge id carries the namespace segment (KTD-7 id parity).
    expect(edges).toContain(
      systemEdgeId("tenant-1", "can-777", "lastmile", "ns-a"),
    );
  });

  it("is deterministic — same input rows yield identical CSV bytes (AE3)", () => {
    const build = () =>
      buildBulkLoadCsvFiles({
        tenantId: "tenant-1",
        canonicals: [activeCanonical, mergedLoser],
        mappingsByCanonical: mapOf([["can-777", twoMappings]]),
      });
    expect(build()).toEqual(build());
  });

  it("falls back to the generic Entity label for a malformed type slug", () => {
    const { files } = buildBulkLoadCsvFiles({
      tenantId: "tenant-1",
      canonicals: [{ ...activeCanonical, entity_type_slug: "bad) DELETE (n" }],
      mappingsByCanonical: mapOf([]),
    });
    const nodes = files.find(
      (f) => f.name === BULK_CSV_FILE_NAMES.entityNodes,
    )!.content;
    expect(nodes.split("\n")[1].split(",")[1]).toBe("Entity");
  });

  it("merged loser: skipped entirely — no node, no edges, counted", () => {
    const { files, counts } = buildBulkLoadCsvFiles({
      tenantId: "tenant-1",
      canonicals: [mergedLoser],
      // Repointed mappings live on the survivor; a loser row with mappings
      // still emits nothing for them (mirrors the resync loser path).
      mappingsByCanonical: mapOf([["can-loser", twoMappings]]),
    });
    expect(counts.externalIdentityEdges).toBe(0);
    expect(counts.mergedLosersSkipped).toBe(1);
    expect(counts.entityNodes).toBe(0);
    expect(counts.systemNodes).toBe(0);
    // Zero rows means no files at all — the loser leaves no trace.
    expect(files).toEqual([]);
  });

  it("private mappings produce no edges and no orphan system nodes", () => {
    const { files, counts } = buildBulkLoadCsvFiles({
      tenantId: "tenant-1",
      canonicals: [activeCanonical],
      mappingsByCanonical: mapOf([
        [
          "can-777",
          [
            {
              source_system: "gmail",
              namespace: "user-1",
              external_id: "someone@example.com",
              visibility: "private",
            },
          ],
        ],
      ]),
    });
    expect(counts.externalIdentityEdges).toBe(0);
    expect(counts.systemNodes).toBe(0);
    expect(files.some((f) => f.name === BULK_CSV_FILE_NAMES.systemNodes)).toBe(
      false,
    );
    expect(files.some((f) => f.name === BULK_CSV_FILE_NAMES.edges)).toBe(false);
  });

  it("escapes commas, quotes, and newlines per RFC 4180 and round-trips", () => {
    const gnarly = 'He said "hi", twice\nsecond line';
    const { files } = buildBulkLoadCsvFiles({
      tenantId: "tenant-1",
      canonicals: [{ ...activeCanonical, display_name: gnarly }],
      mappingsByCanonical: mapOf([]),
    });
    const nodes = files.find(
      (f) => f.name === BULK_CSV_FILE_NAMES.entityNodes,
    )!.content;
    expect(nodes).toContain('"He said ""hi"", twice\nsecond line"');

    // Minimal RFC 4180 parse-back of the data record.
    const body = nodes.slice(nodes.indexOf("\n") + 1);
    const fields: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < body.length; i += 1) {
      const ch = body[i];
      if (inQuotes) {
        if (ch === '"' && body[i + 1] === '"') {
          field += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(field);
        field = "";
      } else if (ch === "\n") {
        break;
      } else {
        field += ch;
      }
    }
    fields.push(field);
    expect(fields[4]).toBe(gnarly);
  });

  it("empty tenant yields no files and zero counts", () => {
    const { files, counts } = buildBulkLoadCsvFiles({
      tenantId: "tenant-1",
      canonicals: [],
      mappingsByCanonical: mapOf([]),
    });
    expect(files).toEqual([]);
    expect(counts.canonicals).toBe(0);
  });

  it("builder ids are byte-identical to the nudge lane's resync op ids (interleaving convergence)", () => {
    const { files } = buildBulkLoadCsvFiles({
      tenantId: "tenant-1",
      canonicals: [activeCanonical],
      mappingsByCanonical: mapOf([["can-777", twoMappings]]),
    });
    const ops = buildCanonicalResyncOps({
      tenantId: "tenant-1",
      canonical: activeCanonical,
      mappings: twoMappings,
    });
    const opIds = new Set<string>();
    for (const op of ops) {
      for (const key of ["nodeId", "sysId", "edgeId"]) {
        const value = op.parameters[key];
        if (typeof value === "string") opIds.add(value);
      }
    }
    // Every CSV row id (first column of every data row) is an id the nudge
    // lane MERGEs — a resync interleaved between clear and load lands on
    // the same ~ids the loader upserts, so the graph converges instead of
    // colliding ("Cannot create node; id already in use").
    const csvIds = files
      .flatMap((f) => f.content.split("\n").slice(1))
      .filter((line) => line.length > 0)
      .map((line) => line.split(",")[0]);
    expect(csvIds.length).toBeGreaterThan(0);
    for (const id of csvIds) {
      expect(opIds.has(id), `csv id ${id} missing from resync ops`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// U2 — orchestrator: fence, watermark, deadline guard, loader lifecycle
// ---------------------------------------------------------------------------

const NOW = new Date("2026-07-22T12:00:00Z");
const WATERMARK_AT = new Date("2026-07-22T11:59:00Z");

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    loadBucket: "load-bucket",
    loaderRoleArn: "arn:aws:iam::1:role/loader",
    region: "us-east-1",
    pollIntervalMs: 0,
    sleep: async () => {},
    now: NOW,
    ...overrides,
  };
}

const fenceRow = (over: Record<string, unknown> = {}) => ({
  tenant_id: "tenant-1",
  bulk_load_id: null,
  bulk_load_started_at: null,
  bulk_watermark_created_at: null,
  bulk_watermark_event_id: null,
  ...over,
});

describe("bulkRebuildTenantGraph", () => {
  it("happy path: watermark → clear → extract → upload → start → poll → snapshot + cursor to watermark → staged delete → fence release", async () => {
    const timeline: string[] = [];
    const fake = createFakeIdentityDb();
    const neptune = new FakeNeptune(timeline);
    const loader = new FakeLoader(timeline);
    const { s3, puts, deletes } = makeFakeS3(timeline);

    fake.selectQueue.push(
      [], // fence read — no cursor row yet
      [{ id: "evt-9", created_at: WATERMARK_AT }], // watermark newest event
      [activeCanonical, mergedLoser], // extract canonicals
      [
        {
          canonical_entity_id: "can-777",
          source_system: "twenty",
          namespace: "",
          external_id: "cmp_889",
          visibility: "tenant",
        },
      ], // extract mappings
      [
        fenceRow({
          bulk_load_id: "load-1",
          bulk_load_started_at: NOW,
          bulk_watermark_created_at: WATERMARK_AT,
          bulk_watermark_event_id: "evt-9",
        }),
      ], // finalize fence re-read
      [], // snapshot mappings
      [], // snapshot redirects
    );
    fake.insertReturningQueue.push([{ tenant_id: "tenant-1" }]); // CAS claim wins
    loader.statusQueue.push({ status: "LOAD_COMPLETED" });

    const result = await bulkRebuildTenantGraph(
      baseArgs({
        clear: true,
        db: fake.db,
        neptune,
        s3,
        loader,
      }) as never,
    );

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      loadId: "load-1",
      cursor: `${WATERMARK_AT.toISOString()}#evt-9`,
    });
    expect((result as { counts: { canonicals: number } }).counts).toMatchObject(
      {
        canonicals: 2,
        entityNodes: 1,
        externalIdentityEdges: 1,
        mergedLosersSkipped: 1,
      },
    );

    // Clear ran before any upload, uploads before the loader start (AE2 +
    // R3 sequencing).
    const clearIdx = timeline.indexOf("clear-batch");
    const firstPut = timeline.findIndex((e) => e.startsWith("put:"));
    const startIdx = timeline.indexOf("start-load");
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    expect(firstPut).toBeGreaterThan(clearIdx);
    expect(startIdx).toBeGreaterThan(firstPut);

    // Staged under the tenant/run prefix; loader called with the FULL
    // bucket-relative prefix (KTD-7).
    const csvPuts = puts.filter((p) => p.Bucket === "load-bucket");
    expect(csvPuts).toHaveLength(3);
    expect(csvPuts[0].Key).toMatch(
      /^thinkwork-identity\/tenant-1\/[0-9a-f-]+\/nodes-entities\.csv$/,
    );
    expect(loader.started[0].source).toBe(
      `s3://load-bucket/${csvPuts[0].Key!.replace(/nodes-entities\.csv$/, "")}`,
    );
    expect(loader.started[0].iamRoleArn).toBe("arn:aws:iam::1:role/loader");

    // Success tail: cursor upsert targets the persisted extract watermark
    // and the fence clears in the same write.
    const finalWrite = fake.updates.find(
      (w) => (w.values as { last_event_id?: string }).last_event_id === "evt-9",
    );
    expect(finalWrite).toBeDefined();
    expect(finalWrite!.table).toBe(identityGraphProjectionCursors);
    expect(finalWrite!.values).toMatchObject({
      last_snapshot_cursor: `${WATERMARK_AT.toISOString()}#evt-9`,
      bulk_load_id: null,
      bulk_load_started_at: null,
      bulk_watermark_created_at: null,
      bulk_watermark_event_id: null,
    });

    // Staged CSVs deleted on terminal success (KTD-7).
    expect(deletes.map((d) => d.Key)).toEqual(
      Object.values(BULK_CSV_FILE_NAMES).map(
        (name) =>
          `${csvPuts[0].Key!.replace(/nodes-entities\.csv$/, "")}${name}`,
      ),
    );

    // The snapshot upload also happened (brain artifacts bucket).
    expect(
      puts.some((p) => p.Key === "twin-identity/tenant-1/latest.json"),
    ).toBe(true);
  });

  it("AE1 watermark half: finalize uses the persisted extract watermark, never a finalize-time newest event", async () => {
    // An event committed AFTER extract ("evt-10") exists by finalize time;
    // the cursor must still land on evt-9 so evt-10 replays via nudge.
    const fake = createFakeIdentityDb();
    const loader = new FakeLoader();
    const { s3 } = makeFakeS3();
    fake.selectQueue.push(
      [], // fence read
      [{ id: "evt-9", created_at: WATERMARK_AT }], // extract watermark
      [activeCanonical], // canonicals
      [], // mappings
      [
        fenceRow({
          bulk_load_id: "load-1",
          bulk_load_started_at: NOW,
          bulk_watermark_created_at: WATERMARK_AT,
          bulk_watermark_event_id: "evt-9",
        }),
      ], // finalize fence re-read
      [], // snapshot mappings
      [], // snapshot redirects
    );
    fake.insertReturningQueue.push([{ tenant_id: "tenant-1" }]);
    loader.statusQueue.push({ status: "LOAD_COMPLETED" });

    const result = await bulkRebuildTenantGraph(
      baseArgs({ db: fake.db, s3, loader }) as never,
    );
    expect(result.ok).toBe(true);
    // No select against entity_resolution_events after the loader completed
    // — the watermark select was the ONLY events read (queue fully drained
    // in the order above), and the cursor write names evt-9.
    expect(fake.selectQueue).toEqual([]);
    const finalWrite = fake.updates.find(
      (w) => (w.values as { last_event_id?: string }).last_event_id,
    );
    expect(finalWrite!.values.last_event_id).toBe("evt-9");
  });

  it("AE4: loader failure → fence released, staged CSVs deleted, error returned, cursor untouched", async () => {
    const fake = createFakeIdentityDb();
    const loader = new FakeLoader();
    const { s3, deletes } = makeFakeS3();
    fake.selectQueue.push(
      [],
      [{ id: "evt-9", created_at: WATERMARK_AT }],
      [activeCanonical],
      [],
    );
    fake.insertReturningQueue.push([{ tenant_id: "tenant-1" }]);
    loader.statusQueue.push(
      { status: "LOAD_FAILED" },
      { status: "LOAD_FAILED", payload: { errors: ["bad row"] } },
    );

    const result = await bulkRebuildTenantGraph(
      baseArgs({ db: fake.db, s3, loader }) as never,
    );

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      loaderStatus: "LOAD_FAILED",
      loaderErrors: { errors: ["bad row"] },
    });
    // Error feed fetched with errors: true.
    expect(loader.statusCalls.some((c) => c.errors === true)).toBe(true);
    // Staged CSVs deleted on terminal failure too.
    expect(deletes.length).toBe(3);
    // Fence released…
    const release = fake.updates.find(
      (w) =>
        (w.values as { bulk_load_started_at?: unknown })
          .bulk_load_started_at === null &&
        (w.values as { bulk_load_id?: unknown }).bulk_load_id === null,
    );
    expect(release).toBeDefined();
    // …and ZERO cursor writes (AE4).
    expect(
      fake.updates.some(
        (w) =>
          "last_event_id" in w.values || "last_snapshot_cursor" in w.values,
      ),
    ).toBe(false);
  });

  it("deadline guard mid-poll (resume path): returns in_progress, fence held, no cursor write, staged CSVs retained", async () => {
    const fake = createFakeIdentityDb();
    const loader = new FakeLoader();
    const { s3, deletes } = makeFakeS3();
    fake.selectQueue.push([
      fenceRow({ bulk_load_id: "load-1", bulk_load_started_at: NOW }),
    ]);
    loader.statusQueue.push({ status: "LOAD_IN_PROGRESS" });

    const result = await bulkRebuildTenantGraph(
      baseArgs({
        db: fake.db,
        s3,
        loader,
        loadId: "load-1",
        getRemainingTimeMs: () => 10_000, // under the 90s margin
      }) as never,
    );

    expect(result).toEqual({
      ok: false,
      status: "in_progress",
      tenantId: "tenant-1",
      loadId: "load-1",
    });
    expect(deletes).toEqual([]);
    // Heartbeat refreshed, but no release (started_at never set to null)
    // and no cursor write.
    expect(
      fake.updates.some(
        (w) =>
          (w.values as { bulk_load_started_at?: unknown })
            .bulk_load_started_at === null,
      ),
    ).toBe(false);
    expect(fake.updates.some((w) => "last_event_id" in w.values)).toBe(false);
  });

  it("deadline guard pre-start: trip during extract releases the fence with a phase-named error", async () => {
    const fake = createFakeIdentityDb();
    const loader = new FakeLoader();
    const { s3 } = makeFakeS3();
    fake.selectQueue.push([], [{ id: "evt-9", created_at: WATERMARK_AT }]);
    fake.insertReturningQueue.push([{ tenant_id: "tenant-1" }]);

    const result = await bulkRebuildTenantGraph(
      baseArgs({
        db: fake.db,
        s3,
        loader,
        getRemainingTimeMs: () => 0,
      }) as never,
    );

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      phase: "extract",
    });
    expect((result as { error: string }).error).toContain("extract");
    expect(loader.started).toEqual([]);
    const release = fake.updates.find(
      (w) =>
        (w.values as { bulk_load_started_at?: unknown })
          .bulk_load_started_at === null,
    );
    expect(release).toBeDefined();
  });

  it("resume: fenced loadId skips extract/upload/start, polls with heartbeats, finalizes on completion", async () => {
    const fake = createFakeIdentityDb();
    const loader = new FakeLoader();
    const { s3, puts, deletes } = makeFakeS3();
    fake.selectQueue.push(
      [fenceRow({ bulk_load_id: "load-1", bulk_load_started_at: NOW })],
      [
        fenceRow({
          bulk_load_id: "load-1",
          bulk_load_started_at: NOW,
          bulk_watermark_created_at: WATERMARK_AT,
          bulk_watermark_event_id: "evt-9",
        }),
      ],
      [], // snapshot mappings
      [], // snapshot redirects
    );
    loader.statusQueue.push(
      { status: "LOAD_IN_PROGRESS" },
      {
        status: "LOAD_COMPLETED",
        fullUri: "s3://load-bucket/thinkwork-identity/tenant-1/run-x/",
      },
    );

    const result = await bulkRebuildTenantGraph(
      baseArgs({ db: fake.db, s3, loader, loadId: "load-1" }) as never,
    );

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      loadId: "load-1",
      cursor: `${WATERMARK_AT.toISOString()}#evt-9`,
    });
    // No extract/upload/start on resume.
    expect(loader.started).toEqual([]);
    expect(puts.filter((p) => p.Bucket === "load-bucket")).toEqual([]);
    // Each poll refreshed the heartbeat (2 polls → ≥2 heartbeat updates
    // before the final cursor write).
    const heartbeats = fake.updates.filter(
      (w) =>
        (w.values as { bulk_load_started_at?: unknown })
          .bulk_load_started_at instanceof Date &&
        !("last_event_id" in w.values),
    );
    expect(heartbeats.length).toBeGreaterThanOrEqual(2);
    // Cleanup derived the staged prefix from the loader's fullUri.
    expect(deletes.map((d) => d.Key)).toEqual(
      Object.values(BULK_CSV_FILE_NAMES).map(
        (name) => `thinkwork-identity/tenant-1/run-x/${name}`,
      ),
    );
  });

  it("resume mismatch: names the held loadId, no poll, no cursor write", async () => {
    const fake = createFakeIdentityDb();
    const loader = new FakeLoader();
    const { s3 } = makeFakeS3();
    fake.selectQueue.push([
      fenceRow({ bulk_load_id: "load-A", bulk_load_started_at: NOW }),
    ]);

    const result = await bulkRebuildTenantGraph(
      baseArgs({ db: fake.db, s3, loader, loadId: "load-B" }) as never,
    );
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("load-A");
    expect(loader.statusCalls).toEqual([]);
    expect(fake.updates).toEqual([]);
  });

  it("resume with no fence held: errors with nothing-to-resume", async () => {
    const fake = createFakeIdentityDb();
    const loader = new FakeLoader();
    const { s3 } = makeFakeS3();
    fake.selectQueue.push([]); // no cursor row

    const result = await bulkRebuildTenantGraph(
      baseArgs({ db: fake.db, s3, loader, loadId: "load-B" }) as never,
    );
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("nothing to resume");
    expect(loader.statusCalls).toEqual([]);
  });

  it("fence contention: live fence returns its loadId and performs no clear", async () => {
    const fake = createFakeIdentityDb();
    const neptune = new FakeNeptune();
    const loader = new FakeLoader();
    const { s3 } = makeFakeS3();
    // Heartbeat 1 minute old — fresh.
    fake.selectQueue.push([
      fenceRow({
        bulk_load_id: "load-A",
        bulk_load_started_at: new Date(NOW.getTime() - 60_000),
      }),
    ]);

    const result = await bulkRebuildTenantGraph(
      baseArgs({ db: fake.db, neptune, s3, loader, clear: true }) as never,
    );
    expect(result).toEqual({
      ok: false,
      status: "in_progress",
      tenantId: "tenant-1",
      loadId: "load-A",
    });
    expect(neptune.ops).toEqual([]);
    expect(fake.inserts).toEqual([]);
  });

  it("stale takeover with the old load still running: cancels + confirms terminal before claiming", async () => {
    const fake = createFakeIdentityDb();
    const loader = new FakeLoader();
    const { s3, deletes } = makeFakeS3();
    fake.selectQueue.push(
      [
        fenceRow({
          bulk_load_id: "load-old",
          bulk_load_started_at: new Date(NOW.getTime() - 31 * 60_000),
        }),
      ],
      [{ id: "evt-9", created_at: WATERMARK_AT }],
      [activeCanonical],
      [],
      [
        fenceRow({
          bulk_load_id: "load-1",
          bulk_load_started_at: NOW,
          bulk_watermark_created_at: WATERMARK_AT,
          bulk_watermark_event_id: "evt-9",
        }),
      ],
      [],
      [],
    );
    fake.insertReturningQueue.push([{ tenant_id: "tenant-1" }]);
    loader.statusQueue.push(
      { status: "LOAD_IN_PROGRESS" }, // old load pre-cancel
      {
        status: "LOAD_CANCELLED_BY_USER",
        fullUri: "s3://load-bucket/thinkwork-identity/tenant-1/run-old/",
      }, // old load post-cancel
      { status: "LOAD_COMPLETED" }, // new load
    );

    const result = await bulkRebuildTenantGraph(
      baseArgs({ db: fake.db, s3, loader }) as never,
    );
    expect(result.ok).toBe(true);
    expect(loader.cancelled).toEqual(["load-old"]);
    // Dead run's staged prefix cleaned during takeover.
    expect(
      deletes.some((d) =>
        d.Key!.startsWith("thinkwork-identity/tenant-1/run-old/"),
      ),
    ).toBe(true);
  });

  it("stale takeover refuses when the old load will not go terminal", async () => {
    const fake = createFakeIdentityDb();
    const loader = new FakeLoader();
    const { s3 } = makeFakeS3();
    fake.selectQueue.push([
      fenceRow({
        bulk_load_id: "load-old",
        bulk_load_started_at: new Date(NOW.getTime() - 31 * 60_000),
      }),
    ]);
    loader.statusQueue.push(
      { status: "LOAD_IN_PROGRESS" },
      { status: "LOAD_IN_PROGRESS" }, // still running after cancel
    );

    const result = await bulkRebuildTenantGraph(
      baseArgs({ db: fake.db, s3, loader }) as never,
    );
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("still");
    expect(fake.inserts).toEqual([]); // no claim
  });

  it("CAS race lost: empty RETURNING reports in_progress instead of clearing", async () => {
    const fake = createFakeIdentityDb();
    const neptune = new FakeNeptune();
    const loader = new FakeLoader();
    const { s3 } = makeFakeS3();
    fake.selectQueue.push([]); // no fence at read time
    fake.insertReturningQueue.push([]); // …but the CAS loses the race

    const result = await bulkRebuildTenantGraph(
      baseArgs({ db: fake.db, neptune, s3, loader, clear: true }) as never,
    );
    expect(result).toMatchObject({ ok: false, status: "in_progress" });
    expect(neptune.ops).toEqual([]);
  });

  it("AE2 unit half: clear: true issues the id-prefix fenced clear before upload; no-clear runs never DETACH DELETE", async () => {
    const runOnce = async (clear: boolean) => {
      const fake = createFakeIdentityDb();
      const neptune = new FakeNeptune();
      const loader = new FakeLoader();
      const { s3 } = makeFakeS3();
      fake.selectQueue.push(
        [],
        [{ id: "evt-9", created_at: WATERMARK_AT }],
        [activeCanonical],
        [],
        [
          fenceRow({
            bulk_watermark_event_id: "evt-9",
            bulk_watermark_created_at: WATERMARK_AT,
          }),
        ],
        [],
        [],
      );
      fake.insertReturningQueue.push([{ tenant_id: "tenant-1" }]);
      loader.statusQueue.push({ status: "LOAD_COMPLETED" });
      await bulkRebuildTenantGraph(
        baseArgs({ db: fake.db, neptune, s3, loader, clear }) as never,
      );
      return neptune.ops;
    };

    const clearOps = await runOnce(true);
    expect(clearOps.some((op) => op.query.includes("DETACH DELETE"))).toBe(
      true,
    );
    expect(clearOps[0].parameters).toEqual({ idPrefix: "t#tenant-1#" });

    const noClearOps = await runOnce(false);
    expect(noClearOps.some((op) => op.query.includes("DETACH DELETE"))).toBe(
      false,
    );
  });

  it("empty tenant: completes without a loader job, cursor string is the empty sentinel", async () => {
    const fake = createFakeIdentityDb();
    const loader = new FakeLoader();
    const { s3, puts, deletes } = makeFakeS3();
    fake.selectQueue.push(
      [], // fence read
      [], // no events → no watermark
      [], // canonicals page 1 — empty, so no mappings query is issued
      [fenceRow()], // finalize fence re-read (no watermark)
      [], // snapshot mappings
      [], // snapshot redirects
    );
    fake.insertReturningQueue.push([{ tenant_id: "tenant-1" }]);

    const result = await bulkRebuildTenantGraph(
      baseArgs({ db: fake.db, s3, loader }) as never,
    );
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      loadId: null,
      cursor: "bulk-rebuild#empty",
    });
    expect(loader.started).toEqual([]);
    expect(puts.filter((p) => p.Bucket === "load-bucket")).toEqual([]);
    expect(deletes).toEqual([]);
    // Fence released via the success-tail write; no event-cursor columns.
    const finalWrite = fake.updates.find(
      (w) => "last_snapshot_cursor" in w.values,
    );
    expect(finalWrite!.values).toMatchObject({
      last_snapshot_cursor: "bulk-rebuild#empty",
      bulk_load_started_at: null,
    });
    expect("last_event_id" in finalWrite!.values).toBe(false);
  });

  // -------------------------------------------------------------------------
  // THINK-409 — streaming extract/staging: flat memory, identical bytes
  // -------------------------------------------------------------------------

  describe("streaming extract + multipart staging", () => {
    /** Four canonicals across two pages; page 2 reuses page 1's "twenty"
     * system (dedup must span pages) and carries a merged loser. */
    const pagedCanonicals = [
      { ...activeCanonical, id: "can-001", display_name: "Alpha, Inc." },
      {
        ...activeCanonical,
        id: "can-002",
        display_name: 'Beta "Bee"',
        entity_type_slug: "bad) DELETE (n",
      },
      { ...mergedLoser, id: "can-003" },
      { ...activeCanonical, id: "can-004", display_name: "Delta\nDivision" },
    ];
    const mappingsById: Record<string, MappingRowForSync[]> = {
      "can-001": twoMappings,
      "can-002": [
        {
          source_system: "gmail",
          namespace: "user-1",
          external_id: "nope@example.com",
          visibility: "private",
        },
      ],
      "can-003": twoMappings, // loser: repointed rows must emit nothing
      "can-004": [
        // "twenty" again — the ExternalSystem node was already emitted on
        // page 1, so no second system row may appear.
        {
          source_system: "twenty",
          namespace: "",
          external_id: "cmp_999",
          visibility: "tenant",
        },
        {
          source_system: "not a slug!",
          namespace: "",
          external_id: "x",
          visibility: "tenant",
        },
      ],
    };

    const withMappingKey = (id: string) =>
      mappingsById[id].map((m) => ({ ...m, canonical_entity_id: id }));

    /** Queue the paged extract selects for pageSize 2 over the fixture. */
    function queuePagedExtract(fake: ReturnType<typeof createFakeIdentityDb>) {
      fake.selectQueue.push(
        [], // fence read
        [{ id: "evt-9", created_at: WATERMARK_AT }], // watermark
        pagedCanonicals.slice(0, 2), // page 1
        [...withMappingKey("can-001"), ...withMappingKey("can-002")],
        pagedCanonicals.slice(2, 4), // page 2
        [...withMappingKey("can-003"), ...withMappingKey("can-004")],
        [], // page 3 — empty, extract stops
        [
          fenceRow({
            bulk_load_id: "load-1",
            bulk_load_started_at: NOW,
            bulk_watermark_created_at: WATERMARK_AT,
            bulk_watermark_event_id: "evt-9",
          }),
        ], // finalize fence re-read
        [], // snapshot mappings
        [], // snapshot redirects
      );
      fake.insertReturningQueue.push([{ tenant_id: "tenant-1" }]);
    }

    const golden = () =>
      buildBulkLoadCsvFiles({
        tenantId: "tenant-1",
        canonicals: pagedCanonicals,
        mappingsByCanonical: mapOf(
          Object.entries(mappingsById) as Array<[string, MappingRowForSync[]]>,
        ),
      });

    it("multi-page extract stages bytes identical to the whole-file builder (and counts to match)", async () => {
      const fake = createFakeIdentityDb();
      const loader = new FakeLoader();
      const { s3, objects, partCounts } = makeFakeS3();
      queuePagedExtract(fake);
      loader.statusQueue.push({ status: "LOAD_COMPLETED" });

      const result = await bulkRebuildTenantGraph(
        baseArgs({
          db: fake.db,
          s3,
          loader,
          extractPageSize: 2,
          // Force real multipart: every row overflows the part buffer.
          uploadPartBytes: 1,
        }) as never,
      );

      expect(result.ok).toBe(true);
      const expected = golden();
      expect((result as { counts: unknown }).counts).toEqual(expected.counts);
      // Sanity: the fixture exercises every rule (loser skipped, private
      // mapping dropped, bad slug dropped, system dedup across the page
      // boundary, quoted fields).
      expect(expected.counts).toEqual({
        canonicals: 4,
        entityNodes: 3,
        systemNodes: 2,
        externalIdentityEdges: 3,
        mergedLosersSkipped: 1,
      });

      const prefix = [...objects.keys()][0].replace(/[^/]+$/, "");
      for (const file of expected.files) {
        expect(objects.get(`${prefix}${file.name}`)).toBe(file.content);
      }
      const stagedKeys = [...objects.keys()].filter((k) =>
        k.startsWith(prefix),
      );
      expect(stagedKeys.sort()).toEqual(
        expected.files.map((f) => `${prefix}${f.name}`).sort(),
      );
      // Multipart actually ran (one part per row + header, not one PutObject).
      expect(
        partCounts.get(`${prefix}${BULK_CSV_FILE_NAMES.entityNodes}`) ?? 0,
      ).toBeGreaterThan(1);
    });

    it("small files take the single PutObject path but stage identical bytes", async () => {
      const fake = createFakeIdentityDb();
      const loader = new FakeLoader();
      const { s3, objects, puts, partCounts } = makeFakeS3();
      queuePagedExtract(fake);
      loader.statusQueue.push({ status: "LOAD_COMPLETED" });

      const result = await bulkRebuildTenantGraph(
        baseArgs({ db: fake.db, s3, loader, extractPageSize: 2 }) as never,
      );

      expect(result.ok).toBe(true);
      expect(partCounts.size).toBe(0); // no multipart at all
      expect(puts.filter((p) => p.Bucket === "load-bucket")).toHaveLength(3);
      const prefix = [...objects.keys()][0].replace(/[^/]+$/, "");
      for (const file of golden().files) {
        expect(objects.get(`${prefix}${file.name}`)).toBe(file.content);
      }
    });

    it("staging failure aborts the in-flight multipart uploads and releases the fence", async () => {
      const fake = createFakeIdentityDb();
      const loader = new FakeLoader();
      const { s3, aborts } = makeFakeS3(undefined, {
        onUploadPart: (partNumber) => {
          if (partNumber === 3) throw new Error("s3 exploded");
        },
      });
      queuePagedExtract(fake);

      const result = await bulkRebuildTenantGraph(
        baseArgs({
          db: fake.db,
          s3,
          loader,
          extractPageSize: 2,
          uploadPartBytes: 1,
        }) as never,
      );

      expect(result).toMatchObject({ ok: false, status: "failed" });
      expect((result as { error: string }).error).toContain("s3 exploded");
      expect(loader.started).toEqual([]);
      // The entity-node upload was in flight — it must be aborted, not left
      // to accrue orphaned parts.
      expect(aborts.length).toBeGreaterThan(0);
      expect(aborts.every((a) => a.UploadId !== undefined)).toBe(true);
      const release = fake.updates.find(
        (w) =>
          (w.values as { bulk_load_started_at?: unknown })
            .bulk_load_started_at === null,
      );
      expect(release).toBeDefined();
    });

    it("deadline trip between pages fails in the extract phase and stages no load", async () => {
      const fake = createFakeIdentityDb();
      const loader = new FakeLoader();
      const { s3, aborts } = makeFakeS3();
      queuePagedExtract(fake);
      // Plenty of time for the pre-extract check, none after page 1.
      let calls = 0;
      const getRemainingTimeMs = () => {
        calls += 1;
        return calls > 1 ? 0 : 10 * 60_000;
      };

      const result = await bulkRebuildTenantGraph(
        baseArgs({
          db: fake.db,
          s3,
          loader,
          extractPageSize: 2,
          uploadPartBytes: 1,
          getRemainingTimeMs,
        }) as never,
      );

      expect(result).toMatchObject({ ok: false, status: "failed" });
      expect((result as { error: string }).error).toContain("extract");
      expect(loader.started).toEqual([]);
      expect(aborts.length).toBeGreaterThan(0);
    });
  });

  it("unconfigured (no load bucket / loader role): structured failure, nothing touched", async () => {
    const fake = createFakeIdentityDb();
    const result = await bulkRebuildTenantGraph({
      tenantId: "tenant-1",
      db: fake.db,
      loadBucket: "",
      loaderRoleArn: "",
    } as never);
    expect(result).toMatchObject({ ok: false, status: "failed" });
    expect((result as { error: string }).error).toContain("not configured");
    expect(fake.inserts).toEqual([]);
    expect(fake.updates).toEqual([]);
  });
});
