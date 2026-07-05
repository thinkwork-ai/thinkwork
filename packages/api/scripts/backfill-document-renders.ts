#!/usr/bin/env tsx
/**
 * Document Compositor v2 (THINK-154 U6): operator-triggered corpus backfill —
 * recompile existing document artifacts' digests through the compositor
 * (R11/R12). The launch proof for the compositor: after this runs, every
 * document on the stage renders in the house style.
 *
 * Per KTD6, `final` documents get BOTH a refreshed head render (what readers
 * serve) and a new pinned version through the guarded pin path; the prior
 * render stays in version history. Drafts have no version history and are
 * skipped by default; `--include-drafts` snapshots the existing render to
 * `render/backfill-backup-<runid>.html` before overwriting.
 *
 * Usage:
 *
 *   # Dry-run: report what would change, write nothing
 *   DATABASE_URL=… ARTIFACT_PAYLOADS_BUCKET=… \
 *     pnpm -C packages/api exec tsx scripts/backfill-document-renders.ts --dry-run
 *
 *   # Canary batch: compile at most 5 documents, report, stop — eyeball the
 *   # five on dev before an unbounded run.
 *   …  scripts/backfill-document-renders.ts --limit 5
 *
 *   # Full run
 *   …  scripts/backfill-document-renders.ts
 *
 *   # Other flags: --tenant <slug>  --concurrency N  --include-drafts
 *
 * Documents whose digest fails to compile (unknown legacy content) are
 * skipped and reported, never abort the run. Exits 1 only on fatal errors.
 */

import { getDb } from "@thinkwork/database-pg";
import { artifacts, tenants } from "@thinkwork/database-pg/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  backfillBackupRenderKey,
  runDocumentBackfill,
  type BackfillDocumentRow,
  type DocumentBackfillStore,
} from "../src/lib/artifacts/document-backfill.js";
import { pinDocumentHead } from "../src/lib/artifacts/document-emission.js";
import {
  artifactContentKey,
  artifactRenderKey,
  readArtifactPayloadFromS3,
  writeArtifactPayloadToS3,
} from "../src/lib/artifacts/payload-storage.js";

const RENDER_CONTENT_TYPE = "text/html; charset=utf-8";

interface CliOptions {
  dryRun: boolean;
  includeDrafts: boolean;
  limit: number | undefined;
  concurrency: number;
  tenantSlug: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    includeDrafts: false,
    limit: undefined,
    concurrency: 4,
    tenantSlug: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--include-drafts") {
      opts.includeDrafts = true;
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
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: backfill-document-renders [--dry-run] [--limit N] [--tenant slug] [--concurrency N] [--include-drafts]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function makeStore(tenantSlug: string | null): DocumentBackfillStore {
  const db = getDb();
  const loadRow = async (id: string): Promise<BackfillDocumentRow | null> => {
    const rows = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, id))
      .limit(1);
    return (rows[0] as unknown as BackfillDocumentRow | undefined) ?? null;
  };
  return {
    listDocuments: async () => {
      const documentFilter = sql`${artifacts.metadata}->>'kind' = 'document'`;
      if (!tenantSlug) {
        const rows = await db.select().from(artifacts).where(documentFilter);
        return rows as unknown as BackfillDocumentRow[];
      }
      const tenantRows = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, tenantSlug))
        .limit(1);
      if (!tenantRows[0]) throw new Error(`Unknown tenant slug: ${tenantSlug}`);
      const rows = await db
        .select()
        .from(artifacts)
        .where(and(documentFilter, eq(artifacts.tenant_id, tenantRows[0].id)));
      return rows as unknown as BackfillDocumentRow[];
    },
    readDigest: (row) =>
      readArtifactPayloadFromS3({
        tenantId: row.tenant_id,
        key: artifactContentKey({
          tenantId: row.tenant_id,
          artifactId: row.id,
        }),
      }),
    writeRenderHead: (row, renderHtml) =>
      writeArtifactPayloadToS3({
        tenantId: row.tenant_id,
        key: artifactRenderKey({ tenantId: row.tenant_id, artifactId: row.id }),
        body: renderHtml,
        contentType: RENDER_CONTENT_TYPE,
      }),
    snapshotRender: async (row, runId) => {
      const current = await readArtifactPayloadFromS3({
        tenantId: row.tenant_id,
        key: artifactRenderKey({ tenantId: row.tenant_id, artifactId: row.id }),
      });
      await writeArtifactPayloadToS3({
        tenantId: row.tenant_id,
        key: backfillBackupRenderKey({
          tenantId: row.tenant_id,
          artifactId: row.id,
          runId,
        }),
        body: current,
        contentType: RENDER_CONTENT_TYPE,
      });
    },
    pinHead: async (row, digestMarkdown, renderHtml) => {
      const pin = await pinDocumentHead({
        row,
        userId: null,
        digestMarkdown,
        renderHtml,
      });
      return { headVersion: pin.headVersion, pinned: pin.pinned };
    },
    reloadRow: (row) => loadRow(row.id),
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const runId = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "-")
    .slice(0, 19);
  console.log(
    `document-render backfill${opts.dryRun ? " (DRY RUN)" : ""} runId=${runId}${opts.tenantSlug ? ` tenant=${opts.tenantSlug}` : ""}${opts.limit !== undefined ? ` limit=${opts.limit}` : ""}${opts.includeDrafts ? " include-drafts" : ""}`,
  );

  const report = await runDocumentBackfill(makeStore(opts.tenantSlug), {
    dryRun: opts.dryRun,
    includeDrafts: opts.includeDrafts,
    limit: opts.limit,
    concurrency: opts.concurrency,
    runId,
    log: (line) => console.log(`  ${line}`),
  });

  console.log(
    `\nDone${report.dryRun ? " (dry run — nothing written)" : ""}: total=${report.total} processed=${report.processed} pinnedFinals=${report.pinnedFinals} overwrittenDrafts=${report.overwrittenDrafts} skippedDrafts=${report.skippedDrafts} skippedNonGenre=${report.skippedNonGenre} compileFailures=${report.compileFailures.length} conflicts=${report.conflicts.length} unprocessed=${report.unprocessed}`,
  );
  for (const failure of report.compileFailures) {
    console.warn(
      `  ✗ compile failed: ${failure.artifactId} [${failure.codes.join(",")}]`,
    );
  }
  for (const id of report.conflicts) {
    console.warn(`  ✗ pin conflict (re-run to retry): ${id}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error in backfill-document-renders:", err);
  process.exit(1);
});
