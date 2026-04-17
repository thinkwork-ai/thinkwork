import { gqlQuery } from "../../../lib/gql-client.js";
import { isJsonMode, printJson, printKeyValue } from "../../../lib/output.js";
import { printError } from "../../../ui.js";
import { EvalTestCaseDoc } from "../gql.js";
import { resolveEvalContext, fmtIso, type EvalCliOptions } from "../helpers.js";

export async function runEvalTestCaseGet(id: string, opts: EvalCliOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);
  const data = await gqlQuery(ctx.client, EvalTestCaseDoc, { id });
  if (!data.evalTestCase) {
    printError(`Test case ${id} not found.`);
    process.exit(1);
  }
  const tc = data.evalTestCase;

  if (isJsonMode()) {
    printJson(tc);
    return;
  }

  printKeyValue([
    ["ID", tc.id],
    ["Name", tc.name],
    ["Category", tc.category],
    ["Agent template", tc.agentTemplateName ?? tc.agentTemplateId ?? "—"],
    ["Source", tc.source],
    ["Enabled", tc.enabled ? "yes" : "no"],
    ["Evaluators", (tc.agentcoreEvaluatorIds ?? []).join(", ") || "—"],
    ["Tags", (tc.tags ?? []).join(", ") || "—"],
    ["Created", fmtIso(tc.createdAt)],
    ["Updated", fmtIso(tc.updatedAt)],
  ]);
  console.log("");
  console.log("  QUERY");
  console.log("  ─────");
  console.log(`  ${tc.query.split("\n").join("\n  ")}`);
  if (tc.systemPrompt) {
    console.log("");
    console.log("  SYSTEM PROMPT");
    console.log("  ─────────────");
    console.log(`  ${tc.systemPrompt.split("\n").join("\n  ")}`);
  }
  if (tc.assertions) {
    console.log("");
    console.log("  ASSERTIONS");
    console.log("  ──────────");
    console.log(`  ${tc.assertions}`);
  }
}
