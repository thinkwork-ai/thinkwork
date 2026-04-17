import { gqlQuery } from "../../lib/gql-client.js";
import { isJsonMode, printJson, printKeyValue, printTable } from "../../lib/output.js";
import { printError } from "../../ui.js";
import { EvalRunDoc, EvalRunResultsDoc } from "./gql.js";
import {
  resolveEvalContext,
  fmtIso,
  fmtPercent,
  fmtUsd,
  type EvalCliOptions,
} from "./helpers.js";

interface GetOptions extends EvalCliOptions {
  results?: boolean;
}

export async function runEvalGet(runId: string, opts: GetOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);
  const data = await gqlQuery(ctx.client, EvalRunDoc, { id: runId });
  if (!data.evalRun) {
    printError(`Run ${runId} not found.`);
    process.exit(1);
  }
  const run = data.evalRun;

  const results =
    opts.results === false
      ? []
      : (await gqlQuery(ctx.client, EvalRunResultsDoc, { runId })).evalRunResults ?? [];

  if (isJsonMode()) {
    printJson({ run, results });
    return;
  }

  printKeyValue([
    ["Run ID", run.id],
    ["Status", run.status],
    ["Agent template", run.agentTemplateName ?? run.agentTemplateId ?? "—"],
    ["Agent", run.agentName ?? run.agentId ?? "—"],
    ["Model", run.model ?? "—"],
    ["Categories", (run.categories ?? []).join(", ") || "—"],
    ["Pass/Total", `${run.passed}/${run.totalTests}`],
    ["Pass rate", fmtPercent(run.passRate)],
    ["Regression", run.regression ? "YES" : "no"],
    ["Cost", fmtUsd(run.costUsd)],
    ["Error", run.errorMessage ?? "—"],
    ["Started", fmtIso(run.startedAt)],
    ["Completed", fmtIso(run.completedAt)],
  ]);

  if (opts.results !== false && results.length > 0) {
    console.log("");
    const rows = results.map((r) => ({
      name: r.testCaseName ?? "—",
      category: r.category ?? "—",
      status: r.status,
      score: r.score == null ? "—" : r.score.toFixed(3),
      duration: r.durationMs == null ? "—" : `${r.durationMs}ms`,
    }));
    printTable(rows, [
      { key: "name", header: "TEST CASE" },
      { key: "category", header: "CATEGORY" },
      { key: "status", header: "STATUS" },
      { key: "score", header: "SCORE" },
      { key: "duration", header: "DURATION" },
    ]);
  }
}
