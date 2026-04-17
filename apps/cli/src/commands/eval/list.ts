import { gqlQuery } from "../../lib/gql-client.js";
import { isJsonMode, printJson, printTable } from "../../lib/output.js";
import { EvalRunsDoc } from "./gql.js";
import {
  resolveEvalContext,
  fmtIso,
  fmtPercent,
  fmtUsd,
  type EvalCliOptions,
} from "./helpers.js";

interface ListOptions extends EvalCliOptions {
  agent?: string;
  limit?: string;
  offset?: string;
}

export async function runEvalList(opts: ListOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);
  const data = await gqlQuery(ctx.client, EvalRunsDoc, {
    tenantId: ctx.tenantId,
    agentId: opts.agent ?? null,
    limit: Number.parseInt(opts.limit ?? "25", 10),
    offset: Number.parseInt(opts.offset ?? "0", 10),
  });

  const rows = (data.evalRuns.items ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    template: r.agentTemplateName ?? r.agentTemplateId ?? "—",
    categories: (r.categories ?? []).join(", ") || "—",
    tests: `${r.passed}/${r.totalTests}`,
    passRate: fmtPercent(r.passRate),
    cost: fmtUsd(r.costUsd),
    started: fmtIso(r.startedAt),
  }));

  if (isJsonMode()) {
    printJson({ totalCount: data.evalRuns.totalCount, items: data.evalRuns.items });
    return;
  }
  printTable(rows, [
    { key: "id", header: "RUN ID" },
    { key: "status", header: "STATUS" },
    { key: "template", header: "TEMPLATE" },
    { key: "categories", header: "CATEGORIES" },
    { key: "tests", header: "PASS/TOTAL" },
    { key: "passRate", header: "PASS RATE" },
    { key: "cost", header: "COST" },
    { key: "started", header: "STARTED" },
  ]);
}
