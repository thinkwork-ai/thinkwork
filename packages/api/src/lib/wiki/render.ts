/**
 * Wiki page plate renders (THINK-273, parent THINK-270 U2).
 *
 * Compiles a page's assembled markdown through the Document Compositor with
 * the page type's wiki plate and persists the result on the `wiki.pages`
 * row (`render_html` / `render_plate_slug` / `rendered_at`). The render is
 * best-effort derived data: any failure — plate resolution, compositor
 * rejection, oversize output, missing page — degrades to the NULL triple
 * with a logged warning and never fails the enclosing page write (R3).
 *
 * The single production call site is the tail of `upsertSections` in
 * repository.ts (every section-bearing write path funnels there — P1); the
 * backfill script (`scripts/backfill-wiki-renders.ts`) reuses the same
 * helper per page.
 */

import { eq, sql, and } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { wikiPages } from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import { DOCUMENT_RENDER_MAX_BYTES } from "../artifacts/document-preflight.js";

type DbClient = typeof defaultDb | PgTransaction<any, any, any>;

/** Input to the injectable compile seam. */
export interface WikiRenderCompileInput {
  tenantId: string;
  /** Page type: 'entity' | 'topic' | 'decision'. */
  pageType: string;
  title: string;
  summary: string;
  /** Full-page markdown, as written to body_md (renderBodyMarkdown output). */
  markdown: string;
}

export type WikiRenderCompileResult =
  | { ok: true; renderHtml: string; plateSlug: string }
  | { ok: false; reason: string };

export type WikiRenderCompile = (
  input: WikiRenderCompileInput,
) => Promise<WikiRenderCompileResult>;

export interface WikiRenderSource {
  pageId: string;
  /** The assembled full-page markdown the caller just wrote to body_md. */
  markdown: string;
  sectionCount: number;
  /**
   * Compare-and-set guard for out-of-transaction callers (the backfill):
   * the page row's `updated_at::text` captured when the sections were read.
   * When the row's updated_at no longer matches — a live compile committed
   * in between — the render UPDATE is skipped so a fresher render is never
   * overwritten by one built from an older section snapshot. In-transaction
   * callers (upsertSections) omit it; their read and write are atomic.
   */
  expectedUpdatedAt?: string;
}

export type WikiRenderOutcome =
  | { outcome: "rendered"; plateSlug: string; bytes: number }
  /** Compile failed or zero sections: the NULL triple was persisted. */
  | { outcome: "cleared"; reason: string }
  /** Nothing written: page row missing or the CAS guard missed. */
  | { outcome: "skipped"; reason: string }
  /** DB-level failure; the nested transaction rolled back. */
  | { outcome: "error"; reason: string };

/**
 * Default compile: resolve the page type's wiki plate and run the Document
 * Compositor with the in-wiki internal-link policy.
 *
 * THINK-272 (wiki plates + compositor link policy) has not merged yet —
 * `resolveWikiPlate` and the `CompileDocumentInput` link-policy option do
 * not exist on main. Until it lands, every render degrades to the NULL
 * triple (R3 best-effort semantics), which is the documented fallback.
 * Wire-up once THINK-272 is on main:
 *
 *   const plate = await resolveWikiPlate(input.tenantId, input.pageType);
 *   const compiled = compileDocument({
 *     plate,
 *     title: input.title,
 *     abstract: input.summary,
 *     markdownBody: input.markdown,
 *     // + the THINK-272 internal-link policy option
 *   });
 *   if (!compiled.ok) {
 *     return {
 *       ok: false,
 *       reason: compiled.diagnostics.map((d) => d.code).join(","),
 *     };
 *   }
 *   return { ok: true, renderHtml: compiled.renderHtml, plateSlug: plate.slug };
 */
const defaultWikiRenderCompile: WikiRenderCompile = async () => {
  return {
    ok: false,
    reason: "wiki plates unavailable (THINK-272 not yet merged)",
  };
};

const NULL_TRIPLE = {
  render_html: null,
  render_plate_slug: null,
  rendered_at: null,
} as const;

/**
 * Compile and persist the plate render for one page. Never throws (R3):
 * every failure path returns an outcome and leaves the caller's transaction
 * intact. The DB statements run inside a nested transaction (a SAVEPOINT
 * when `db` is already a transaction), so a Postgres-level failure rolls
 * back to the savepoint instead of aborting the enclosing page write.
 */
export async function composeWikiPageRender(
  source: WikiRenderSource,
  db: DbClient = defaultDb,
  compile: WikiRenderCompile = defaultWikiRenderCompile,
): Promise<WikiRenderOutcome> {
  try {
    return await db.transaction(async (tx): Promise<WikiRenderOutcome> => {
      const [page] = await tx
        .select({
          tenant_id: wikiPages.tenant_id,
          type: wikiPages.type,
          title: wikiPages.title,
          summary: wikiPages.summary,
          updated_at_text: sql<string>`${wikiPages.updated_at}::text`,
        })
        .from(wikiPages)
        .where(eq(wikiPages.id, source.pageId))
        .limit(1);

      if (!page) {
        return { outcome: "skipped", reason: "page row missing" };
      }

      // CAS value: what the caller captured, or (in-transaction path) what
      // we just read — the latter trivially matches in the UPDATE below.
      const casUpdatedAt = source.expectedUpdatedAt ?? page.updated_at_text;

      const writeRender = async (
        values:
          | typeof NULL_TRIPLE
          | {
              render_html: string;
              render_plate_slug: string;
              rendered_at: unknown;
            },
      ): Promise<boolean> => {
        const updated = await tx
          .update(wikiPages)
          .set(values as Record<string, unknown>)
          .where(
            and(
              eq(wikiPages.id, source.pageId),
              sql`${wikiPages.updated_at}::text = ${casUpdatedAt}`,
            ),
          )
          .returning({ id: wikiPages.id });
        return updated.length > 0;
      };

      if (source.sectionCount === 0) {
        // No sections → nothing to compile; clear any stale render.
        const wrote = await writeRender(NULL_TRIPLE);
        return wrote
          ? { outcome: "cleared", reason: "page has no sections" }
          : { outcome: "skipped", reason: "concurrent page write (CAS miss)" };
      }

      let compiled: WikiRenderCompileResult;
      try {
        compiled = await compile({
          tenantId: page.tenant_id,
          pageType: page.type,
          title: page.title,
          summary: page.summary ?? "",
          markdown: source.markdown,
        });
      } catch (err) {
        compiled = {
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }

      if (compiled.ok) {
        const bytes = Buffer.byteLength(compiled.renderHtml, "utf8");
        if (bytes <= DOCUMENT_RENDER_MAX_BYTES) {
          const wrote = await writeRender({
            render_html: compiled.renderHtml,
            render_plate_slug: compiled.plateSlug,
            rendered_at: sql`now()`,
          });
          return wrote
            ? { outcome: "rendered", plateSlug: compiled.plateSlug, bytes }
            : {
                outcome: "skipped",
                reason: "concurrent page write (CAS miss)",
              };
        }
        compiled = {
          ok: false,
          reason: `render is ${bytes} bytes; the ceiling is ${DOCUMENT_RENDER_MAX_BYTES}`,
        };
      }

      console.warn(
        `wiki render degraded to NULL for page ${source.pageId}: ${compiled.reason}`,
      );
      const wrote = await writeRender(NULL_TRIPLE);
      return wrote
        ? { outcome: "cleared", reason: compiled.reason }
        : { outcome: "skipped", reason: "concurrent page write (CAS miss)" };
    });
  } catch (err) {
    // DB-level failure: the nested transaction (savepoint) rolled back, so
    // the enclosing page write is unaffected (R3).
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      `wiki render failed for page ${source.pageId} (savepoint rolled back): ${reason}`,
    );
    return { outcome: "error", reason };
  }
}
