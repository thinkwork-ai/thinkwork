/**
 * Inspect a U1 memory workflow run end-to-end (THINK-193 dogfood evidence).
 *
 * Dumps the workflow run row, its step events, task tokens, memory ledger
 * rows (evidence/run items/checkpoint/derivations), the dream ledger row for
 * the target bank, and a live Hindsight recall against the target bank.
 *
 * Usage (dev DATABASE_URL + HINDSIGHT_ENDPOINT exported):
 *   npx tsx scripts/memory-sources/inspect-run.ts --run <workflowRunId> \
 *     [--source <sourceConfigId>] [--bank <bankId>] [--query "..."]
 */

import { desc, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  brainDreamRuns,
  memoryDerivations,
  memoryEvidenceItems,
  memoryRunItems,
  memorySourceCheckpoints,
  workflowRunEvents,
  workflowRuns,
  workflowTaskTokens,
} from "@thinkwork/database-pg/schema";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const runId = arg("run");
  const sourceConfigId = arg("source");
  const bankId = arg("bank");
  const query = arg("query") ?? "What do we know about Acme Probe?";
  const db = getDb();
  const out: Record<string, unknown> = {};

  if (runId) {
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .limit(1);
    out.run = run && {
      id: run.id,
      status: run.status,
      trigger: `${run.trigger_family}/${run.trigger_source}`,
      execution: run.backend_execution_id,
      started_at: run.started_at,
      finished_at: run.finished_at,
    };
    out.events = (
      await db
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.workflow_run_id, runId))
        .orderBy(workflowRunEvents.id)
    ).map((e) => ({
      type: e.event_type,
      at: e.occurred_at ?? e.created_at,
      summary: e.summary,
    }));
    out.tokens = (
      await db
        .select()
        .from(workflowTaskTokens)
        .where(eq(workflowTaskTokens.workflow_run_id, runId))
    ).map((t) => ({
      step: t.step_id,
      purpose: t.purpose,
      status: t.status,
      iteration: t.iteration,
    }));
    out.runItems = (
      await db
        .select()
        .from(memoryRunItems)
        .where(eq(memoryRunItems.workflow_run_id, runId))
        .orderBy(memoryRunItems.id)
    ).map((r) => ({
      stage: r.stage,
      item: r.source_item_id,
      result: r.result,
      detail: r.detail,
    }));
  }

  if (sourceConfigId) {
    out.checkpoints = await db
      .select()
      .from(memorySourceCheckpoints)
      .where(eq(memorySourceCheckpoints.source_config_id, sourceConfigId));
    out.evidence = (
      await db
        .select()
        .from(memoryEvidenceItems)
        .where(eq(memoryEvidenceItems.source_config_id, sourceConfigId))
        .orderBy(desc(memoryEvidenceItems.created_at))
        .limit(50)
    ).map((e) => ({
      item: e.source_item_id,
      version: e.source_version,
      hash: e.content_hash.slice(0, 12),
      lifecycle: e.lifecycle,
      run: e.acquisition_run_id,
    }));
    out.derivations = (
      await db
        .select()
        .from(memoryDerivations)
        .where(eq(memoryDerivations.source_config_id, sourceConfigId))
    ).map((d) => ({
      projection: d.projection_key,
      document: d.hindsight_document_id,
      bank: d.target_bank_id,
      version: d.current_version,
      lifecycle: d.lifecycle,
    }));
  }

  if (bankId) {
    const [dream] = await db
      .select()
      .from(brainDreamRuns)
      .where(eq(brainDreamRuns.bank_id, bankId))
      .orderBy(desc(brainDreamRuns.created_at))
      .limit(1);
    out.latestDream = dream && {
      id: dream.id,
      status: dream.status,
      planned: dream.planned_counts,
      applied: dream.applied_counts,
      finished_at: dream.finished_at,
    };

    const endpoint = process.env.HINDSIGHT_ENDPOINT;
    if (endpoint) {
      const resp = await fetch(
        `${endpoint.replace(/\/$/, "")}/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, budget: "low", max_tokens: 600 }),
          signal: AbortSignal.timeout(60000),
        },
      );
      const json: any = await resp.json().catch(() => ({}));
      out.recall = {
        status: resp.status,
        query,
        texts: (json?.results ?? json?.memory_units ?? [])
          .slice(0, 8)
          .map((u: any) => u.text),
      };
    }
  }

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
