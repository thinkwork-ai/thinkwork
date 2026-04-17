import { readFileSync } from "node:fs";
import { gqlMutate } from "../../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../../lib/output.js";
import { printError, printSuccess } from "../../../ui.js";
import { UpdateEvalTestCaseDoc } from "../gql.js";
import { resolveEvalContext, type EvalCliOptions } from "../helpers.js";

interface UpdateOptions extends EvalCliOptions {
  name?: string;
  category?: string;
  query?: string;
  systemPrompt?: string;
  agentTemplate?: string;
  evaluator?: string[];
  tag?: string[];
  enabled?: boolean;
  assertionsFile?: string;
}

export async function runEvalTestCaseUpdate(id: string, opts: UpdateOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);

  const input: Record<string, unknown> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.category !== undefined) input.category = opts.category;
  if (opts.query !== undefined) input.query = opts.query;
  if (opts.systemPrompt !== undefined) input.systemPrompt = opts.systemPrompt;
  if (opts.agentTemplate !== undefined) input.agentTemplateId = opts.agentTemplate;
  if (opts.evaluator !== undefined) input.agentcoreEvaluatorIds = opts.evaluator;
  if (opts.tag !== undefined) input.tags = opts.tag;
  if (opts.enabled !== undefined) input.enabled = opts.enabled;
  if (opts.assertionsFile) {
    const parsed = JSON.parse(readFileSync(opts.assertionsFile, "utf8"));
    if (!Array.isArray(parsed)) {
      printError(`--assertions-file must contain a JSON array.`);
      process.exit(1);
    }
    input.assertions = parsed;
  }

  if (Object.keys(input).length === 0) {
    printError("No fields to update. Pass at least one --<field>.");
    process.exit(1);
  }

  const res = await gqlMutate(ctx.client, UpdateEvalTestCaseDoc, { id, input: input as any });
  if (isJsonMode()) {
    printJson(res.updateEvalTestCase);
    return;
  }
  printSuccess(`Updated test case ${res.updateEvalTestCase.id}.`);
}
