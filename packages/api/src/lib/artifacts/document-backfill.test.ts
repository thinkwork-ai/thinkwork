/**
 * Document Compositor v2 (THINK-154 U6): backfill core loop — finals refresh
 * the served head AND pin a new version; drafts are excluded unless opted in
 * with a pre-overwrite snapshot; failures skip-and-report (AE4, R11, R12).
 */
import { describe, expect, it } from "vitest";
import {
  backfillBackupRenderKey,
  runDocumentBackfill,
  type BackfillDocumentRow,
  type DocumentBackfillStore,
} from "./document-backfill.js";
import { DocumentEmissionConflict } from "./document-emission.js";

const GOOD_DIGEST = "## Summary\n\nAll quiet on the western front.\n";

function makeRow(
  overrides: Partial<BackfillDocumentRow> = {},
): BackfillDocumentRow {
  return {
    id: "art-1",
    tenant_id: "tenant-1",
    thread_id: "thread-1",
    space_id: null,
    status: "final",
    head_version: 1,
    head_write_seq: 1,
    metadata: { kind: "document", genre: "report", documentId: "doc-1" },
    title: "Q3 Report",
    type: "report",
    summary: "Numbers.",
    ...overrides,
  };
}

interface FakeStoreState {
  headWrites: Array<{ id: string; html: string }>;
  snapshots: Array<{ id: string; runId: string }>;
  pins: Array<{ id: string; render: string }>;
}

function makeStore(
  rows: BackfillDocumentRow[],
  options: {
    digests?: Record<string, string>;
    pinFailures?: string[];
  } = {},
): { store: DocumentBackfillStore; state: FakeStoreState } {
  const state: FakeStoreState = { headWrites: [], snapshots: [], pins: [] };
  const pinFailures = new Set(options.pinFailures ?? []);
  const store: DocumentBackfillStore = {
    listDocuments: async () => rows,
    readDigest: async (row) => options.digests?.[row.id] ?? GOOD_DIGEST,
    writeRenderHead: async (row, html) => {
      state.headWrites.push({ id: row.id, html });
    },
    snapshotRender: async (row, runId) => {
      state.snapshots.push({ id: row.id, runId });
    },
    pinHead: async (row, _digest, render) => {
      if (pinFailures.has(row.id)) {
        pinFailures.delete(row.id); // succeed on retry
        throw new DocumentEmissionConflict("seq moved");
      }
      state.pins.push({ id: row.id, render });
      return { headVersion: (row.head_version ?? 0) + 1, pinned: true };
    },
    reloadRow: async (row) => ({ ...row, head_write_seq: 99 }),
  };
  return { store, state };
}

const OPTS = { dryRun: false, includeDrafts: false, runId: "run-1" };

describe("runDocumentBackfill", () => {
  it("AE4/F3: a final document gets a digest-only recompiled head AND a new pinned version", async () => {
    const { store, state } = makeStore([makeRow()]);
    const report = await runDocumentBackfill(store, OPTS);

    expect(report.pinnedFinals).toBe(1);
    // KTD6: the served head actually changes, not just the version history.
    expect(state.headWrites).toHaveLength(1);
    expect(state.headWrites[0].html).toContain(
      '<meta name="tw-plate" content="report">',
    );
    expect(state.headWrites[0].html).toContain(
      "All quiet on the western front",
    );
    // Content that existed only in the legacy hand-written render is gone.
    expect(state.headWrites[0].html).not.toContain("legacy-only-table");
    expect(state.pins).toHaveLength(1);
    expect(state.pins[0].render).toBe(state.headWrites[0].html);
  });

  it("drafts are skipped and counted without --include-drafts", async () => {
    const { store, state } = makeStore([makeRow({ status: "draft" })]);
    const report = await runDocumentBackfill(store, OPTS);
    expect(report.skippedDrafts).toBe(1);
    expect(report.processed).toBe(0);
    expect(state.headWrites).toHaveLength(0);
    expect(state.snapshots).toHaveLength(0);
  });

  it("opted-in drafts snapshot the prior render before overwrite, and never pin", async () => {
    const { store, state } = makeStore([makeRow({ status: "draft" })]);
    const report = await runDocumentBackfill(store, {
      ...OPTS,
      includeDrafts: true,
    });
    expect(report.overwrittenDrafts).toBe(1);
    expect(state.snapshots).toEqual([{ id: "art-1", runId: "run-1" }]);
    expect(state.headWrites).toHaveLength(1);
    expect(state.pins).toHaveLength(0);
  });

  it("--limit N processes exactly N and reports the remainder", async () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      makeRow({ id: `art-${i}` }),
    );
    const { store, state } = makeStore(rows);
    const report = await runDocumentBackfill(store, { ...OPTS, limit: 5 });
    expect(report.processed).toBe(5);
    expect(state.pins).toHaveLength(5);
    expect(report.unprocessed).toBe(4);
  });

  it("dry-run reports intended changes and writes nothing", async () => {
    const lines: string[] = [];
    const { store, state } = makeStore([
      makeRow(),
      makeRow({ id: "art-2", status: "draft" }),
    ]);
    const report = await runDocumentBackfill(store, {
      ...OPTS,
      dryRun: true,
      includeDrafts: true,
      log: (l) => lines.push(l),
    });
    expect(report.pinnedFinals).toBe(1);
    expect(report.overwrittenDrafts).toBe(1);
    expect(state.headWrites).toHaveLength(0);
    expect(state.snapshots).toHaveLength(0);
    expect(state.pins).toHaveLength(0);
    expect(lines.some((l) => l.includes("[dry-run]"))).toBe(true);
  });

  it("a compile-failing document is skipped, counted, and the run continues", async () => {
    const { store, state } = makeStore(
      [makeRow({ id: "bad" }), makeRow({ id: "good" })],
      { digests: { bad: "## B\n\n```tw:hologram\nx: 1\n```\n" } },
    );
    const report = await runDocumentBackfill(store, OPTS);
    expect(report.compileFailures).toEqual([
      { artifactId: "bad", codes: ["UNKNOWN_DIRECTIVE"] },
    ]);
    expect(report.pinnedFinals).toBe(1);
    expect(state.pins.map((p) => p.id)).toEqual(["good"]);
  });

  it("a pin conflict reloads the row and retries without corrupting", async () => {
    const { store, state } = makeStore([makeRow()], {
      pinFailures: ["art-1"],
    });
    const report = await runDocumentBackfill(store, OPTS);
    expect(report.conflicts).toHaveLength(0);
    expect(report.pinnedFinals).toBe(1);
    expect(state.pins).toHaveLength(1);
  });

  it("unknown genre rows are skipped and counted", async () => {
    const { store } = makeStore([makeRow({ type: "novel" })]);
    const report = await runDocumentBackfill(store, OPTS);
    expect(report.skippedNonGenre).toBe(1);
    expect(report.processed).toBe(0);
  });

  it("backup key shape matches the render-key family", () => {
    expect(
      backfillBackupRenderKey({
        tenantId: "t",
        artifactId: "a",
        runId: "20260705",
      }),
    ).toBe(
      "tenants/t/artifact-payloads/artifacts/a/render/backfill-backup-20260705.html",
    );
  });
});
