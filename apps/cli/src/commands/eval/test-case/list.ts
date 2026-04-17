import { gqlQuery } from "../../../lib/gql-client.js";
import { isJsonMode, printJson, printTable } from "../../../lib/output.js";
import { EvalTestCasesDoc } from "../gql.js";
import { resolveEvalContext, fmtIso, type EvalCliOptions } from "../helpers.js";

interface ListOptions extends EvalCliOptions {
  category?: string;
  search?: string;
}

export async function runEvalTestCaseList(opts: ListOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);
  const data = await gqlQuery(ctx.client, EvalTestCasesDoc, {
    tenantId: ctx.tenantId,
    category: opts.category ?? null,
    search: opts.search ?? null,
  });
  const rows = (data.evalTestCases ?? []).map((tc) => ({
    id: tc.id,
    name: tc.name,
    category: tc.category,
    template: tc.agentTemplateName ?? "—",
    evaluators: (tc.agentcoreEvaluatorIds ?? []).join(", ") || "—",
    enabled: tc.enabled ? "yes" : "no",
    updated: fmtIso(tc.updatedAt),
  }));
  if (isJsonMode()) {
    printJson(data.evalTestCases ?? []);
    return;
  }
  printTable(rows, [
    { key: "id", header: "ID" },
    { key: "name", header: "NAME" },
    { key: "category", header: "CATEGORY" },
    { key: "template", header: "TEMPLATE" },
    { key: "evaluators", header: "EVALUATORS" },
    { key: "enabled", header: "ENABLED" },
    { key: "updated", header: "UPDATED" },
  ]);
}
