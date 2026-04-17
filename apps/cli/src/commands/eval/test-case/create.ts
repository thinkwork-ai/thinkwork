import { readFileSync } from "node:fs";
import { input, select, checkbox } from "@inquirer/prompts";
import { gqlMutate, gqlQuery } from "../../../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../../../lib/interactive.js";
import { isJsonMode, printJson } from "../../../lib/output.js";
import { printError, printSuccess } from "../../../ui.js";
import { AgentTemplatesForEvalDoc, CreateEvalTestCaseDoc } from "../gql.js";
import { resolveEvalContext, type EvalCliOptions } from "../helpers.js";

interface CreateOptions extends EvalCliOptions {
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

const DEFAULT_EVALUATORS = [
  "Builtin.Helpfulness",
  "Builtin.Correctness",
  "Builtin.Faithfulness",
  "Builtin.ToolSelectionAccuracy",
  "Builtin.ToolParameterAccuracy",
  "Builtin.GoalSuccessRate",
];

export async function runEvalTestCaseCreate(opts: CreateOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);
  const interactive = isInteractive();

  let name = opts.name;
  let category = opts.category;
  let query = opts.query;
  let evaluators = opts.evaluator;
  let agentTemplateId = opts.agentTemplate ?? null;

  if (!name || !category || !query) {
    if (!interactive) {
      const missing: string[] = [];
      if (!name) missing.push("--name");
      if (!category) missing.push("--category");
      if (!query) missing.push("--query");
      printError(`Missing required flag(s): ${missing.join(", ")}.`);
      process.exit(1);
    }
  }

  if (!name) {
    requireTty("Name");
    name = await promptOrExit(() =>
      input({ message: "Test case name?", validate: (v) => v.trim().length > 0 || "Required" }),
    );
  }
  if (!category) {
    category = await promptOrExit(() =>
      input({ message: "Category (free-form label)?", validate: (v) => v.trim().length > 0 || "Required" }),
    );
  }
  if (!query) {
    query = await promptOrExit(() =>
      input({ message: "Query the agent under test will receive?", validate: (v) => v.trim().length > 0 || "Required" }),
    );
  }

  if (interactive && agentTemplateId === null) {
    const tpls = await gqlQuery(ctx.client, AgentTemplatesForEvalDoc, { tenantId: ctx.tenantId });
    const templates = tpls.agentTemplates ?? [];
    if (templates.length > 0) {
      const choice = await promptOrExit(() =>
        select({
          message: "Pin to an agent template? (Enter for none)",
          choices: [
            { name: "— none — (runner picks)", value: "" },
            ...templates.map((t) => ({ name: `${t.name}${t.model ? `  (${t.model})` : ""}`, value: t.id })),
          ],
          loop: false,
        }),
      );
      agentTemplateId = choice === "" ? null : choice;
    }
  }

  if (interactive && (!evaluators || evaluators.length === 0)) {
    const picked = await promptOrExit(() =>
      checkbox({
        message: "Evaluators to run for this test case?",
        choices: DEFAULT_EVALUATORS.map((e) => ({ name: e, value: e, checked: e === "Builtin.Helpfulness" })),
        loop: false,
      }),
    );
    evaluators = picked;
  }

  let assertions: Array<{ type: string; value?: string | null; path?: string | null }> | null = null;
  if (opts.assertionsFile) {
    const parsed = JSON.parse(readFileSync(opts.assertionsFile, "utf8"));
    if (!Array.isArray(parsed)) {
      printError(`--assertions-file must contain a JSON array.`);
      process.exit(1);
    }
    assertions = parsed;
  }

  const mutation = await gqlMutate(ctx.client, CreateEvalTestCaseDoc, {
    tenantId: ctx.tenantId,
    input: {
      name: name!,
      category: category!,
      query: query!,
      systemPrompt: opts.systemPrompt ?? null,
      agentTemplateId,
      agentcoreEvaluatorIds: evaluators && evaluators.length > 0 ? evaluators : null,
      tags: opts.tag && opts.tag.length > 0 ? opts.tag : null,
      enabled: opts.enabled ?? true,
      assertions,
    },
  });

  if (isJsonMode()) {
    printJson(mutation.createEvalTestCase);
    return;
  }
  printSuccess(
    `Created test case ${mutation.createEvalTestCase.id} "${mutation.createEvalTestCase.name}" (${mutation.createEvalTestCase.category}).`,
  );
}
