import { describe, expect, it, vi } from "vitest";

import { DOCUMENT_RENDER_MAX_BYTES } from "../artifacts/document-preflight.js";
import { composeWikiPageRender, type WikiRenderCompile } from "./render.js";

interface FakeDbOptions {
  /** Row returned by the page re-read (undefined → page missing). */
  pageRow?: {
    tenant_id: string;
    type: string;
    title: string;
    summary: string | null;
    updated_at_text: string;
  };
  /** Rows the render UPDATE's `.returning()` resolves to ([] = CAS miss). */
  updateReturning?: Array<{ id: string }>;
  /** Reject the render UPDATE at the "Postgres" level. */
  failUpdate?: Error;
  /** Reject the whole nested transaction (simulates an aborted savepoint). */
  failTransaction?: Error;
}

/**
 * Minimal drizzle-shaped fake for the helper's statement sequence: one
 * SELECT (page re-read), then one UPDATE with `.returning()`. Captures the
 * UPDATE's `set` values so tests can assert the exact persisted triple.
 */
function fakeDb(opts: FakeDbOptions = {}) {
  const captured: { sets: Array<Record<string, unknown>> } = { sets: [] };

  const selectChain: any = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () =>
      Promise.resolve(opts.pageRow ? [opts.pageRow] : ([] as unknown[])),
  };

  const makeUpdateChain = (set: Record<string, unknown>) => {
    const chain: any = {
      where: () => chain,
      returning: () => {
        if (opts.failUpdate) return Promise.reject(opts.failUpdate);
        return Promise.resolve(opts.updateReturning ?? [{ id: "page-1" }]);
      },
    };
    captured.sets.push(set);
    return chain;
  };

  const tx: any = {
    select: () => selectChain,
    update: () => ({ set: makeUpdateChain }),
  };

  const db: any = {
    transaction: async (cb: (tx: any) => Promise<unknown>) => {
      if (opts.failTransaction) throw opts.failTransaction;
      return cb(tx);
    },
  };

  return { db, captured };
}

const PAGE_ROW = {
  tenant_id: "tenant-1",
  type: "entity",
  title: "Acme Corp",
  summary: "A customer",
  updated_at_text: "2026-07-13 07:00:00.123456+00",
};

const SOURCE = {
  pageId: "page-1",
  markdown: "## Overview\n\nAcme ships anvils.",
  sectionCount: 2,
};

const okCompile =
  (html = "<html><body>render</body></html>"): WikiRenderCompile =>
  async () => ({ ok: true, renderHtml: html, plateSlug: "wiki-entity" });

describe("composeWikiPageRender", () => {
  it("persists the full render triple on a successful compile", async () => {
    const { db, captured } = fakeDb({ pageRow: PAGE_ROW });
    const compile = vi.fn(okCompile());

    const result = await composeWikiPageRender(SOURCE, db, compile);

    expect(result).toEqual({
      outcome: "rendered",
      plateSlug: "wiki-entity",
      bytes: Buffer.byteLength("<html><body>render</body></html>", "utf8"),
    });
    expect(captured.sets).toHaveLength(1);
    expect(captured.sets[0]!.render_html).toBe(
      "<html><body>render</body></html>",
    );
    expect(captured.sets[0]!.render_plate_slug).toBe("wiki-entity");
    expect(captured.sets[0]!.rendered_at).toBeTruthy();
  });

  it("passes page context and the assembled markdown to the compile seam", async () => {
    const { db } = fakeDb({ pageRow: PAGE_ROW });
    const compile = vi.fn(okCompile());

    await composeWikiPageRender(SOURCE, db, compile);

    expect(compile).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      pageType: "entity",
      title: "Acme Corp",
      summary: "A customer",
      markdown: SOURCE.markdown,
    });
  });

  it("persists the NULL triple when the compile throws (AE2)", async () => {
    const { db, captured } = fakeDb({ pageRow: PAGE_ROW });
    const compile: WikiRenderCompile = async () => {
      throw new Error("plate resolution exploded");
    };

    const result = await composeWikiPageRender(SOURCE, db, compile);

    expect(result).toEqual({
      outcome: "cleared",
      reason: "plate resolution exploded",
    });
    expect(captured.sets).toEqual([
      { render_html: null, render_plate_slug: null, rendered_at: null },
    ]);
  });

  it("persists the NULL triple when the compile reports ok: false (AE2)", async () => {
    const { db, captured } = fakeDb({ pageRow: PAGE_ROW });
    const compile: WikiRenderCompile = async () => ({
      ok: false,
      reason: "DIRECTIVE_GENRE_RESTRICTED",
    });

    const result = await composeWikiPageRender(SOURCE, db, compile);

    expect(result).toEqual({
      outcome: "cleared",
      reason: "DIRECTIVE_GENRE_RESTRICTED",
    });
    expect(captured.sets).toEqual([
      { render_html: null, render_plate_slug: null, rendered_at: null },
    ]);
  });

  it("persists the NULL triple when the render exceeds the byte cap", async () => {
    const { db, captured } = fakeDb({ pageRow: PAGE_ROW });
    const oversize = "x".repeat(DOCUMENT_RENDER_MAX_BYTES + 1);

    const result = await composeWikiPageRender(SOURCE, db, okCompile(oversize));

    expect(result.outcome).toBe("cleared");
    expect((result as { reason: string }).reason).toContain("ceiling");
    expect(captured.sets).toEqual([
      { render_html: null, render_plate_slug: null, rendered_at: null },
    ]);
  });

  it("accepts a render exactly at the byte cap", async () => {
    const { db } = fakeDb({ pageRow: PAGE_ROW });
    const atCap = "x".repeat(DOCUMENT_RENDER_MAX_BYTES);

    const result = await composeWikiPageRender(SOURCE, db, okCompile(atCap));

    expect(result.outcome).toBe("rendered");
  });

  it("clears any stale render when the page has zero sections", async () => {
    const { db, captured } = fakeDb({ pageRow: PAGE_ROW });
    const compile = vi.fn(okCompile());

    const result = await composeWikiPageRender(
      { ...SOURCE, sectionCount: 0 },
      db,
      compile,
    );

    expect(result).toEqual({
      outcome: "cleared",
      reason: "page has no sections",
    });
    expect(compile).not.toHaveBeenCalled();
    expect(captured.sets).toEqual([
      { render_html: null, render_plate_slug: null, rendered_at: null },
    ]);
  });

  it("no-ops without throwing when the page row is missing", async () => {
    const { db, captured } = fakeDb({ pageRow: undefined });

    const result = await composeWikiPageRender(SOURCE, db, okCompile());

    expect(result).toEqual({ outcome: "skipped", reason: "page row missing" });
    expect(captured.sets).toHaveLength(0);
  });

  it("skips the write when the CAS guard misses (concurrent compile won)", async () => {
    const { db } = fakeDb({ pageRow: PAGE_ROW, updateReturning: [] });

    const result = await composeWikiPageRender(
      { ...SOURCE, expectedUpdatedAt: "2026-07-13 06:59:00.000001+00" },
      db,
      okCompile(),
    );

    expect(result).toEqual({
      outcome: "skipped",
      reason: "concurrent page write (CAS miss)",
    });
  });

  it("never lets a DB-level UPDATE failure escape (R3 savepoint guard)", async () => {
    const { db } = fakeDb({
      pageRow: PAGE_ROW,
      failUpdate: new Error("value too long for type"),
    });

    const result = await composeWikiPageRender(SOURCE, db, okCompile());

    expect(result).toEqual({
      outcome: "error",
      reason: "value too long for type",
    });
  });

  it("never lets an aborted nested transaction escape (R3)", async () => {
    const { db } = fakeDb({
      failTransaction: new Error("current transaction is aborted"),
    });

    const result = await composeWikiPageRender(SOURCE, db, okCompile());

    expect(result).toEqual({
      outcome: "error",
      reason: "current transaction is aborted",
    });
  });

  it("degrades to the NULL triple with the default compile until THINK-272 lands", async () => {
    const { db, captured } = fakeDb({ pageRow: PAGE_ROW });

    const result = await composeWikiPageRender(SOURCE, db);

    expect(result.outcome).toBe("cleared");
    expect((result as { reason: string }).reason).toContain("THINK-272");
    expect(captured.sets).toEqual([
      { render_html: null, render_plate_slug: null, rendered_at: null },
    ]);
  });
});
