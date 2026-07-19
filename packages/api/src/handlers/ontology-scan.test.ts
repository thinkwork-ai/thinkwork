import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ontologySuggestionScanJobs,
  tenants,
} from "@thinkwork/database-pg/schema";

const { mockRunOntologySuggestionScan, mockStartOntologySuggestionScanJob } =
  vi.hoisted(() => ({
    mockRunOntologySuggestionScan: vi.fn(),
    mockStartOntologySuggestionScanJob: vi.fn(),
  }));

vi.mock("../lib/ontology/suggestions.js", () => ({
  runOntologySuggestionScan: mockRunOntologySuggestionScan,
  startOntologySuggestionScanJob: mockStartOntologySuggestionScanJob,
}));

import { handler, processOntologyScan } from "./ontology-scan.js";

/** Table-keyed fake db for the sweep branch's tenant/in-flight selects. */
class FakeSweepDb {
  constructor(private selectQueues: Map<unknown, unknown[][]>) {}

  select(_projection?: unknown) {
    const takeRows = (table: unknown) => {
      const queue = this.selectQueues.get(table);
      return queue && queue.length > 0 ? queue.shift()! : [];
    };
    let rows: unknown[] = [];
    const chain: any = {
      from: (table: unknown) => {
        rows = takeRows(table);
        return chain;
      },
      where: () => chain,
      then: (resolve: any, reject: any) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  }
}

describe("ontology-scan handler", () => {
  beforeEach(() => {
    mockRunOntologySuggestionScan.mockReset();
    mockStartOntologySuggestionScanJob.mockReset();
  });

  it("runs the durable ontology scan job", async () => {
    mockRunOntologySuggestionScan.mockResolvedValue({
      status: "succeeded",
      tenantId: "tenant-1",
      jobId: "job-1",
      createdChangeSetIds: ["change-set-1"],
      updatedChangeSetIds: [],
      noOp: false,
    });

    const response = await handler({ tenantId: "tenant-1", jobId: "job-1" });

    expect(response.statusCode).toBe(200);
    expect(mockRunOntologySuggestionScan).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      jobId: "job-1",
    });
    expect(mockStartOntologySuggestionScanJob).not.toHaveBeenCalled();
  });

  it("rejects malformed events before touching the scanner", async () => {
    await expect(handler({ tenantId: "tenant-1" })).rejects.toThrow(
      /requires tenantId and jobId/,
    );
    expect(mockRunOntologySuggestionScan).not.toHaveBeenCalled();
  });

  it("sweep events enumerate tenants and enqueue a scan job per tenant", async () => {
    const db = new FakeSweepDb(
      new Map<unknown, unknown[][]>([
        [tenants, [[{ id: "tenant-1" }, { id: "tenant-2" }]]],
        [ontologySuggestionScanJobs, [[]]],
      ]),
    );
    const startScanJob = vi
      .fn()
      .mockResolvedValueOnce({ id: "job-a" })
      .mockResolvedValueOnce({ id: "job-b" });

    const response = await processOntologyScan(
      { sweep: true, trigger: "scheduled" },
      { db: db as any, startScanJob },
    );

    expect(startScanJob).toHaveBeenCalledTimes(2);
    expect(startScanJob).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", trigger: "scheduled" }),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      sweep: true,
      results: [
        { tenantId: "tenant-1", state: "enqueued", jobId: "job-a" },
        { tenantId: "tenant-2", state: "enqueued", jobId: "job-b" },
      ],
    });
    expect(mockRunOntologySuggestionScan).not.toHaveBeenCalled();
  });

  it("sweep skips tenants with an in-flight scan (dedupe)", async () => {
    const db = new FakeSweepDb(
      new Map<unknown, unknown[][]>([
        [tenants, [[{ id: "tenant-1" }, { id: "tenant-2" }]]],
        [ontologySuggestionScanJobs, [[{ tenant_id: "tenant-2" }]]],
      ]),
    );
    const startScanJob = vi.fn().mockResolvedValue({ id: "job-a" });

    const response = await processOntologyScan(
      { sweep: true, trigger: "scheduled" },
      { db: db as any, startScanJob },
    );

    expect(startScanJob).toHaveBeenCalledTimes(1);
    expect(startScanJob).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1" }),
    );
    expect(JSON.parse(response.body).results).toEqual([
      { tenantId: "tenant-1", state: "enqueued", jobId: "job-a" },
      { tenantId: "tenant-2", state: "skipped_in_flight" },
    ]);
  });

  it("sweep records per-tenant start failures without aborting the sweep", async () => {
    const db = new FakeSweepDb(
      new Map<unknown, unknown[][]>([
        [tenants, [[{ id: "tenant-1" }, { id: "tenant-2" }]]],
        [ontologySuggestionScanJobs, [[]]],
      ]),
    );
    const startScanJob = vi
      .fn()
      .mockRejectedValueOnce(new Error("start boom"))
      .mockResolvedValueOnce({ id: "job-b" });

    const response = await processOntologyScan(
      { sweep: true },
      { db: db as any, startScanJob },
    );

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).results).toEqual([
      { tenantId: "tenant-1", state: "error", error: "start boom" },
      { tenantId: "tenant-2", state: "enqueued", jobId: "job-b" },
    ]);
  });
});
