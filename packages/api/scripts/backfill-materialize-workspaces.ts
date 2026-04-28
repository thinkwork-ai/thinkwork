#!/usr/bin/env tsx
/**
 * One-time backfill: walk every agent in this stage and copy
 * template + defaults files into the agent's S3 prefix.
 *
 * Per docs/plans/2026-04-27-003 (materialize-at-write-time): the runtime
 * reads only the agent's prefix. Existing agents predate `bootstrapAgent
 * Workspace` and have empty (or sparse) prefixes; this script populates
 * them so the runtime cutover (Phase C, U6+) finds a complete tree.
 *
 * Idempotent. Re-runs are safe — `preserve-existing` mode skips files
 * that already exist at the agent prefix, so operator-edited content
 * is never clobbered.
 *
 * Usage:
 *
 *   # Dry-run: report what would be written, write nothing
 *   DATABASE_URL=… WORKSPACE_BUCKET=… \
 *     pnpm -C packages/api exec tsx scripts/backfill-materialize-workspaces.ts --dry-run
 *
 *   # Apply
 *   DATABASE_URL=… WORKSPACE_BUCKET=… \
 *     pnpm -C packages/api exec tsx scripts/backfill-materialize-workspaces.ts
 *
 *   # Apply with custom concurrency (default 10)
 *   …  scripts/backfill-materialize-workspaces.ts --concurrency 20
 *
 *   # Restrict to a single tenant by slug (debugging / staged rollout)
 *   …  scripts/backfill-materialize-workspaces.ts --tenant acme
 *
 * Per-agent failure is logged and continues — a single bad agent can't
 * block the whole backfill. Exits 0 if at least one agent succeeded;
 * exits 1 only if every attempted agent failed.
 */

import { getDb } from "@thinkwork/database-pg";
import { agents, tenants } from "@thinkwork/database-pg/schema";
import { eq } from "drizzle-orm";
import { bootstrapAgentWorkspace } from "../src/lib/workspace-bootstrap.js";

interface CliOptions {
  dryRun: boolean;
  concurrency: number;
  tenantSlug: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false, concurrency: 10, tenantSlug: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--concurrency") {
      const next = argv[++i];
      const n = Number(next);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(
          `--concurrency requires a positive integer, got: ${next}`,
        );
      }
      opts.concurrency = n;
    } else if (arg === "--tenant") {
      const next = argv[++i];
      if (!next) throw new Error("--tenant requires a slug");
      opts.tenantSlug = next;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: backfill-materialize-workspaces [--dry-run] [--concurrency N] [--tenant slug]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

interface AgentSummary {
  id: string;
  name: string | null;
  tenantId: string;
  written?: number;
  skipped?: number;
  total?: number;
  error?: string;
}

async function processAgent(
  agentId: string,
  agentName: string | null,
  tenantId: string,
  dryRun: boolean,
): Promise<AgentSummary> {
  const summary: AgentSummary = { id: agentId, name: agentName, tenantId };
  try {
    if (dryRun) {
      // Resolve via the same code path; we don't write anything because
      // overwriting WORKSPACE_BUCKET to "" would also fail elsewhere, and
      // mocking S3 here adds more complexity than the dry-run is worth.
      // Instead: just report intent. Real write counts come from the
      // apply pass.
      summary.written = -1;
      summary.skipped = -1;
      summary.total = -1;
      return summary;
    }
    const result = await bootstrapAgentWorkspace(agentId, {
      mode: "preserve-existing",
    });
    summary.written = result.written;
    summary.skipped = result.skipped;
    summary.total = result.total;
    return summary;
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
    return summary;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!process.env.WORKSPACE_BUCKET) {
    throw new Error("WORKSPACE_BUCKET must be set");
  }

  const db = getDb();
  let rows: { id: string; name: string | null; tenant_id: string }[];

  if (opts.tenantSlug) {
    const [tenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, opts.tenantSlug));
    if (!tenant) throw new Error(`No tenant with slug "${opts.tenantSlug}"`);
    rows = await db
      .select({ id: agents.id, name: agents.name, tenant_id: agents.tenant_id })
      .from(agents)
      .where(eq(agents.tenant_id, tenant.id));
  } else {
    rows = await db
      .select({ id: agents.id, name: agents.name, tenant_id: agents.tenant_id })
      .from(agents);
  }

  console.log(
    `Backfill: ${rows.length} agent(s) (tenant=${opts.tenantSlug ?? "all"}, concurrency=${opts.concurrency}, dryRun=${opts.dryRun}).`,
  );

  const summaries: AgentSummary[] = [];
  for (let i = 0; i < rows.length; i += opts.concurrency) {
    const batch = rows.slice(i, i + opts.concurrency);
    const results = await Promise.all(
      batch.map((row) =>
        processAgent(row.id, row.name, row.tenant_id, opts.dryRun),
      ),
    );
    summaries.push(...results);
  }

  let ok = 0;
  let failed = 0;
  let totalWritten = 0;
  let totalSkipped = 0;
  for (const s of summaries) {
    if (s.error) {
      failed++;
      console.warn(`  ✗ ${s.id} (${s.name ?? "unnamed"}): ${s.error}`);
      continue;
    }
    ok++;
    if (opts.dryRun) {
      console.log(`  • ${s.id} (${s.name ?? "unnamed"}) — would bootstrap`);
    } else {
      totalWritten += s.written ?? 0;
      totalSkipped += s.skipped ?? 0;
      console.log(
        `  ✓ ${s.id} (${s.name ?? "unnamed"}): written=${s.written}, skipped=${s.skipped}, total=${s.total}`,
      );
    }
  }

  console.log(
    `\nDone: ${ok} ok, ${failed} failed${opts.dryRun ? "" : `, totalWritten=${totalWritten}, totalSkipped=${totalSkipped}`}.`,
  );

  // Exit 0 unless every attempted agent failed — partial failures don't
  // block the deploy; an operator can re-run the backfill against just
  // the failed agents.
  if (rows.length > 0 && failed === rows.length) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error in backfill-materialize-workspaces:", err);
  process.exit(1);
});
