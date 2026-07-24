/**
 * Pure planning logic for s3-connect sources (external S3 KB source U2):
 * glob semantics (exclusion wins, `*` crosses `/`), and the direct-ingestion
 * delta plan (new/changed → ingest; removed OR newly-excluded → delete;
 * oversize → counted skip).
 */

import { describe, expect, it } from "vitest";

import {
  batch,
  globToRegExp,
  keyMatchesFilters,
  planDirectIngestion,
  MAX_DIRECT_INGEST_BYTES,
} from "./kb-source-sync.js";

describe("globToRegExp", () => {
  it("matches * across path segments", () => {
    expect(
      globToRegExp("*Retired Procedures/*").test(
        "cx/files/Retired Procedures/old-sop.pdf",
      ),
    ).toBe(true);
    expect(
      globToRegExp("*Retired Procedures/*").test("cx/files/current-sop.pdf"),
    ).toBe(false);
  });

  it("treats regex metacharacters literally and ? as one char", () => {
    expect(
      globToRegExp("cx/files/v1.2/doc?.pdf").test("cx/files/v1.2/doc7.pdf"),
    ).toBe(true);
    expect(
      globToRegExp("cx/files/v1.2/doc?.pdf").test("cx/files/v1x2/doc7.pdf"),
    ).toBe(false);
  });
});

describe("keyMatchesFilters", () => {
  it("includes everything when no patterns", () => {
    expect(keyMatchesFilters("a/b.pdf", null)).toBe(true);
    expect(keyMatchesFilters("a/b.pdf", {})).toBe(true);
  });

  it("exclusion wins over inclusion", () => {
    const patterns = { include: ["cx/files/*"], exclude: ["*Retired*"] };
    expect(keyMatchesFilters("cx/files/sop.pdf", patterns)).toBe(true);
    expect(
      keyMatchesFilters("cx/files/Retired Procedures/sop.pdf", patterns),
    ).toBe(false);
  });

  it("empty include list means include-all (exclusions still apply)", () => {
    const patterns = { exclude: ["*.tmp"] };
    expect(keyMatchesFilters("cx/files/a.pdf", patterns)).toBe(true);
    expect(keyMatchesFilters("cx/files/a.tmp", patterns)).toBe(false);
  });
});

describe("planDirectIngestion", () => {
  const object = (key: string, etag = "e1", sizeBytes = 100) => ({
    key,
    etag,
    sizeBytes,
  });
  const row = (
    document_key: string,
    etag = "e1",
    ingest_status = "indexed",
  ) => ({ document_key, etag, ingest_status });

  it("ingests new and etag-changed keys only", () => {
    const plan = planDirectIngestion({
      liveObjects: [object("a.pdf"), object("b.pdf", "e2"), object("c.pdf")],
      manifest: [row("a.pdf"), row("b.pdf", "e1")],
      patterns: null,
    });
    expect(plan.toIngest.map((o) => o.key).sort()).toEqual(["b.pdf", "c.pdf"]);
    expect(plan.toDelete).toEqual([]);
  });

  it("re-ingests failed and pending manifest rows", () => {
    const plan = planDirectIngestion({
      liveObjects: [object("a.pdf"), object("b.pdf")],
      manifest: [row("a.pdf", "e1", "failed"), row("b.pdf", "e1", "pending")],
      patterns: null,
    });
    expect(plan.toIngest.map((o) => o.key).sort()).toEqual(["a.pdf", "b.pdf"]);
  });

  it("deletes keys removed from the bucket", () => {
    const plan = planDirectIngestion({
      liveObjects: [object("a.pdf")],
      manifest: [row("a.pdf"), row("gone.pdf")],
      patterns: null,
    });
    expect(plan.toDelete).toEqual(["gone.pdf"]);
  });

  it("AE1: a doc moved under an excluded folder is deleted, not ingested", () => {
    // The move changes the key: old key vanishes from the live set, the new
    // key matches the exclusion.
    const patterns = { exclude: ["*Retired Procedures/*"] };
    const plan = planDirectIngestion({
      liveObjects: [
        object("cx/files/Retired Procedures/sop-14.pdf"),
        object("cx/files/sop-15.pdf"),
      ],
      manifest: [row("cx/files/sop-14.pdf"), row("cx/files/sop-15.pdf")],
      patterns,
    });
    expect(plan.excluded).toEqual(["cx/files/Retired Procedures/sop-14.pdf"]);
    expect(plan.toIngest).toEqual([]);
    expect(plan.toDelete).toEqual(["cx/files/sop-14.pdf"]);
  });

  it("a previously-ingested key that NOW matches a new exclusion is deleted", () => {
    const plan = planDirectIngestion({
      liveObjects: [object("cx/files/draft.tmp"), object("cx/files/sop.pdf")],
      manifest: [row("cx/files/draft.tmp"), row("cx/files/sop.pdf")],
      patterns: { exclude: ["*.tmp"] },
    });
    expect(plan.toDelete).toEqual(["cx/files/draft.tmp"]);
  });

  it("skips oversize files and counts them", () => {
    const plan = planDirectIngestion({
      liveObjects: [
        object("big.pdf", "e1", MAX_DIRECT_INGEST_BYTES + 1),
        object("ok.pdf"),
      ],
      manifest: [],
      patterns: null,
    });
    expect(plan.skippedOversize).toEqual(["big.pdf"]);
    expect(plan.toIngest.map((o) => o.key)).toEqual(["ok.pdf"]);
  });

  it("never re-deletes absent_verified rows", () => {
    const plan = planDirectIngestion({
      liveObjects: [],
      manifest: [row("gone.pdf", "e1", "absent_verified")],
      patterns: null,
    });
    expect(plan.toDelete).toEqual([]);
  });
});

describe("batch", () => {
  it("chunks by 10 by default", () => {
    const groups = batch(Array.from({ length: 23 }, (_, i) => i));
    expect(groups.map((g) => g.length)).toEqual([10, 10, 3]);
  });
});
