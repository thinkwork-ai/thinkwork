import { gqlQuery } from "../../lib/gql-client.js";
import { isJsonMode, printJson, printTable } from "../../lib/output.js";
import { EvalTestCasesDoc } from "./gql.js";
import { resolveEvalContext, type EvalCliOptions } from "./helpers.js";

export async function runEvalCategories(opts: EvalCliOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);
  const data = await gqlQuery(ctx.client, EvalTestCasesDoc, { tenantId: ctx.tenantId });

  const counts = new Map<string, { total: number; enabled: number }>();
  for (const tc of data.evalTestCases ?? []) {
    const entry = counts.get(tc.category) ?? { total: 0, enabled: 0 };
    entry.total += 1;
    if (tc.enabled) entry.enabled += 1;
    counts.set(tc.category, entry);
  }

  const rows = Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, { total, enabled }]) => ({
      category,
      enabled: String(enabled),
      total: String(total),
    }));

  if (isJsonMode()) {
    printJson(rows);
    return;
  }
  printTable(rows, [
    { key: "category", header: "CATEGORY" },
    { key: "enabled", header: "ENABLED" },
    { key: "total", header: "TOTAL" },
  ]);
}
