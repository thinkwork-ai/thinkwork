#!/usr/bin/env tsx
/**
 * One-shot backfill for U4 of the workspace-reviews routing refactor.
 *
 * Iterates every `awaiting_review` workspace run, classifies it via the
 * U1 chain walker, and inserts an `inbox_items` row for each system /
 * unrouted run that doesn't already have one. Paired-human runs are
 * skipped (those live on mobile, not Inbox).
 *
 * Idempotent: safe to re-run. Inserts are guarded by an existing-row
 * check inside `materializeReviewAsInboxItem`.
 *
 * Usage:
 *   pnpm tsx packages/api/scripts/backfill-system-reviews-to-inbox.ts
 *   pnpm tsx packages/api/scripts/backfill-system-reviews-to-inbox.ts --tenant <tenant-id>
 *   pnpm tsx packages/api/scripts/backfill-system-reviews-to-inbox.ts --dry-run
 *
 * Plan: docs/plans/2026-04-28-004-refactor-workspace-reviews-routing-and-removal-plan.md
 */

import { agentWorkspaceRuns, db, eq, and } from "../src/graphql/utils.js";
import {
  classifyForMaterialization,
  materializeReviewAsInboxItem,
} from "../src/lib/workspace-events/inbox-materialization.js";

interface CliOptions {
  tenantId: string | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { tenantId: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--tenant") opts.tenantId = argv[++i] ?? null;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: backfill-system-reviews-to-inbox [--tenant <id>] [--dry-run]",
      );
      process.exit(0);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const conditions = [eq(agentWorkspaceRuns.status, "awaiting_review")];
  if (opts.tenantId) {
    conditions.push(eq(agentWorkspaceRuns.tenant_id, opts.tenantId));
  }

  const runs = await db
    .select({
      id: agentWorkspaceRuns.id,
      tenant_id: agentWorkspaceRuns.tenant_id,
      agent_id: agentWorkspaceRuns.agent_id,
      target_path: agentWorkspaceRuns.target_path,
      source_object_key: agentWorkspaceRuns.source_object_key,
    })
    .from(agentWorkspaceRuns)
    .where(and(...conditions));

  console.log(`Found ${runs.length} awaiting_review run(s).`);

  const counters = {
    paired: 0,
    skippedExists: 0,
    created: 0,
  };

  for (const run of runs) {
    const classification = await classifyForMaterialization(
      run.tenant_id,
      run.agent_id,
    );

    if (classification.kind === "paired") {
      counters.paired += 1;
      continue;
    }

    if (opts.dryRun) {
      console.log(
        `[dry-run] would materialize run=${run.id.slice(0, 8)} kind=${classification.kind} agent=${run.agent_id.slice(0, 8)} target=${run.target_path || "/"}`,
      );
      continue;
    }

    const result = await materializeReviewAsInboxItem({
      tenantId: run.tenant_id,
      runId: run.id,
      agentId: run.agent_id,
      targetPath: run.target_path,
      classification,
      reviewObjectKey: run.source_object_key,
    });

    if (result.status === "created") counters.created += 1;
    else if (result.status === "skipped_exists") counters.skippedExists += 1;
  }

  console.log(
    `Summary: created=${counters.created} skipped_exists=${counters.skippedExists} paired_skipped=${counters.paired}`,
  );
}

main().catch((err) => {
  console.error("[backfill-system-reviews-to-inbox] failed", err);
  process.exit(1);
});
