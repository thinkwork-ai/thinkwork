#!/usr/bin/env tsx
/**
 * Wiki render backfill (THINK-273 U4, parent THINK-270 R10): batch-compile
 * plate renders for already-compiled wiki pages from their stored sections.
 * Compositor-only — no LLM/Bedrock call anywhere in the import graph; the
 * page's markdown sections stay canonical and untouched.
 *
 * Idempotent (AE4): the compositor is deterministic, so re-running over
 * already-rendered pages with --force produces byte-identical render_html;
 * the default run skips pages that already have a render.
 *
 * Concurrent-compile guard: each page's updated_at is captured with its
 * sections and the render UPDATE is compare-and-set on it, so a live compile
 * racing the backfill never has its fresher render overwritten by one built
 * from an older section snapshot (skipped pages are reported).
 *
 * Usage:
 *
 *   # Dry-run: report which pages would be rendered, write nothing
 *   DATABASE_URL=… pnpm -C packages/api exec tsx scripts/backfill-wiki-renders.ts --dry-run
 *
 *   # Canary batch: render at most 5 pages, report, stop
 *   …  scripts/backfill-wiki-renders.ts --limit 5
 *
 *   # Full run
 *   …  scripts/backfill-wiki-renders.ts
 *
 *   # Other flags: --tenant <slug>  --page <uuid>  --concurrency N  --force
 *
 * Pages whose compile fails persist the NULL render triple (R3 semantics),
 * are reported, and never abort the run. Exits 1 only on fatal errors.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenants, wikiPages } from "@thinkwork/database-pg/schema";
import {
  listPageSections,
  renderBodyMarkdown,
} from "../src/lib/wiki/repository.js";
import { composeWikiPageRender } from "../src/lib/wiki/render.js";

interface CliOptions {
  dryRun: boolean;
  force: boolean;
  limit: number | undefined;
  concurrency: number;
  tenantSlug: string | null;
  pageId: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    force: false,
    limit: undefined,
    concurrency: 4,
    tenantSlug: null,
    pageId: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--force") {
      opts.force = true;
    } else if (arg === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`--limit requires a positive integer`);
      }
      opts.limit = n;
    } else if (arg === "--concurrency") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`--concurrency requires a positive integer`);
      }
      opts.concurrency = n;
    } else if (arg === "--tenant") {
      const next = argv[++i];
      if (!next) throw new Error("--tenant requires a slug");
      opts.tenantSlug = next;
    } else if (arg === "--page") {
      const next = argv[++i];
      if (!next) throw new Error("--page requires a page id");
      opts.pageId = next;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: backfill-wiki-renders [--dry-run] [--force] [--limit N] [--tenant slug] [--page uuid] [--concurrency N]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

interface EligiblePage {
  id: string;
  title: string;
  type: string;
  hasRender: boolean;
  updatedAtText: string;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const db = getDb();

  console.log(
    `wiki-render backfill${opts.dryRun ? " (DRY RUN)" : ""}${opts.force ? " force" : ""}${opts.tenantSlug ? ` tenant=${opts.tenantSlug}` : ""}${opts.pageId ? ` page=${opts.pageId}` : ""}${opts.limit !== undefined ? ` limit=${opts.limit}` : ""} concurrency=${opts.concurrency}`,
  );

  let tenantId: string | null = null;
  if (opts.tenantSlug) {
    const tenantRows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, opts.tenantSlug))
      .limit(1);
    if (!tenantRows[0]) {
      throw new Error(`Unknown tenant slug: ${opts.tenantSlug}`);
    }
    tenantId = tenantRows[0].id;
  }

  // Eligible: pages with at least one stored section. Default skips pages
  // that already carry a render; --force recompiles them.
  const filters = [
    sql`exists (select 1 from wiki.page_sections s where s.page_id = ${wikiPages.id})`,
  ];
  if (!opts.force) filters.push(isNull(wikiPages.render_html));
  if (tenantId) filters.push(eq(wikiPages.tenant_id, tenantId));
  if (opts.pageId) filters.push(eq(wikiPages.id, opts.pageId));

  const eligible: EligiblePage[] = (
    await db
      .select({
        id: wikiPages.id,
        title: wikiPages.title,
        type: wikiPages.type,
        hasRender: sql<boolean>`${wikiPages.render_html} is not null`,
        updatedAtText: sql<string>`${wikiPages.updated_at}::text`,
      })
      .from(wikiPages)
      .where(and(...filters))
      .orderBy(wikiPages.created_at)
  ).map((r) => ({ ...r, hasRender: Boolean(r.hasRender) }));

  const batch =
    opts.limit !== undefined ? eligible.slice(0, opts.limit) : eligible;
  const unprocessed = eligible.length - batch.length;
  if (unprocessed > 0) {
    console.log(
      `  limit ${opts.limit} reached — ${unprocessed} eligible pages left unprocessed`,
    );
  }

  const counts = {
    rendered: 0,
    cleared: 0,
    skippedConcurrent: 0,
    skippedMissing: 0,
    errors: 0,
    wouldRender: 0,
  };

  const processOne = async (page: EligiblePage): Promise<void> => {
    if (opts.dryRun) {
      counts.wouldRender++;
      console.log(
        `  [dry-run] would render ${page.id} (${page.type}, "${page.title}")${page.hasRender ? " [replacing existing render]" : ""}`,
      );
      return;
    }
    // Sections are read after the updated_at capture above; if a live
    // compile commits in between, the CAS inside composeWikiPageRender
    // misses and the page is skipped — never overwritten with stale bytes.
    const sections = await listPageSections(page.id, db);
    const markdown = renderBodyMarkdown(
      sections.map((s) => ({
        section_slug: s.section_slug,
        heading: s.heading,
        body_md: s.body_md,
        position: s.position,
      })),
    );
    const result = await composeWikiPageRender(
      {
        pageId: page.id,
        markdown,
        sectionCount: sections.length,
        expectedUpdatedAt: page.updatedAtText,
      },
      db,
    );
    if (result.outcome === "rendered") {
      counts.rendered++;
      console.log(
        `  ✓ rendered ${page.id} (${result.plateSlug}, ${result.bytes} bytes)`,
      );
    } else if (result.outcome === "cleared") {
      counts.cleared++;
      console.warn(`  ✗ compile failed → NULL ${page.id}: ${result.reason}`);
    } else if (result.outcome === "skipped") {
      if (result.reason.includes("missing")) counts.skippedMissing++;
      else counts.skippedConcurrent++;
      console.log(`  – skipped ${page.id}: ${result.reason}`);
    } else {
      counts.errors++;
      console.warn(`  ✗ error ${page.id}: ${result.reason}`);
    }
  };

  // Bounded worker pool; per-page failures never abort the run.
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(opts.concurrency, batch.length) },
    async () => {
      while (cursor < batch.length) {
        const page = batch[cursor++]!;
        try {
          await processOne(page);
        } catch (err) {
          counts.errors++;
          console.warn(`  ✗ error ${page.id}: ${String(err)}`);
        }
      }
    },
  );
  await Promise.all(workers);

  console.log(
    `\nDone${opts.dryRun ? " (dry run — nothing written)" : ""}: eligible=${eligible.length} processed=${batch.length} rendered=${counts.rendered} wouldRender=${counts.wouldRender} clearedToNull=${counts.cleared} skippedConcurrent=${counts.skippedConcurrent} skippedMissing=${counts.skippedMissing} errors=${counts.errors} unprocessed=${unprocessed}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error in backfill-wiki-renders:", err);
  process.exit(1);
});
