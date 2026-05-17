import { select, checkbox, confirm } from "@inquirer/prompts";
import ora from "ora";
import { gqlQuery, gqlMutate } from "../../lib/gql-client.js";
import { isInteractive, promptOrExit } from "../../lib/interactive.js";
import {
  isJsonMode,
  printJson,
  printKeyValue,
  logStderr,
} from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { EvalTestCasesDoc, EvalRunDoc, StartEvalRunDoc } from "./gql.js";
import {
  resolveEvalContext,
  fmtPercent,
  isTerminalStatus,
  type EvalCliOptions,
} from "./helpers.js";

interface RunOptions extends EvalCliOptions {
  computer?: string;
  model?: string;
  category?: string[];
  testCase?: string[];
  all?: boolean;
  watch?: boolean;
  timeout?: string;
}

const DEFAULT_EVAL_MODEL_ID = "moonshotai.kimi-k2.5";

export async function runEvalRun(opts: RunOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);
  const interactive = isInteractive();

  const deprecatedComputerId = opts.computer ?? null;
  let categories = opts.category ?? null;
  let testCaseIds = opts.testCase ?? null;

  if (deprecatedComputerId) {
    printError(
      "--computer is no longer supported for eval runs. Evals run directly against the default Agent template.",
    );
    process.exit(1);
  }
  if (opts.model && opts.model !== DEFAULT_EVAL_MODEL_ID) {
    printError(
      `--model is no longer configurable for eval runs. Evals use ${DEFAULT_EVAL_MODEL_ID}.`,
    );
    process.exit(1);
  }

  const scopeSatisfied =
    (testCaseIds && testCaseIds.length > 0) ||
    (categories && categories.length > 0) ||
    opts.all === true;

  if (!scopeSatisfied) {
    if (!interactive) {
      const missing: string[] = [];
      if (!scopeSatisfied)
        missing.push("one of --all | --category | --test-case");
      printError(
        `Missing required flag(s) in non-interactive session: ${missing.join(", ")}.`,
      );
      process.exit(1);
    }
  }

  if (!scopeSatisfied) {
    const scope = await promptOrExit(() =>
      select({
        message: "How should we pick test cases?",
        choices: [
          { name: "All enabled test cases", value: "all" as const },
          { name: "Filter by category", value: "category" as const },
          { name: "Pick specific test cases", value: "specific" as const },
        ],
        loop: false,
      }),
    );

    if (scope === "all") {
      categories = null;
      testCaseIds = null;
      opts.all = true;
    } else if (scope === "category") {
      const tcData = await gqlQuery(ctx.client, EvalTestCasesDoc, {
        tenantId: ctx.tenantId,
      });
      const distinctCategories = Array.from(
        new Set((tcData.evalTestCases ?? []).map((tc) => tc.category)),
      ).sort();
      if (distinctCategories.length === 0) {
        printError(
          "No test cases exist for this tenant yet. Run `thinkwork eval seed` to load the starter pack.",
        );
        process.exit(1);
      }
      const picked = await promptOrExit(() =>
        checkbox({
          message: "Which categories? (space to toggle, enter to confirm)",
          choices: distinctCategories.map((c) => ({ name: c, value: c })),
          required: true,
          loop: false,
        }),
      );
      categories = picked;
    } else {
      const tcData = await gqlQuery(ctx.client, EvalTestCasesDoc, {
        tenantId: ctx.tenantId,
      });
      const options = (tcData.evalTestCases ?? []).filter((tc) => tc.enabled);
      if (options.length === 0) {
        printError("No enabled test cases to pick from.");
        process.exit(1);
      }
      const picked = await promptOrExit(() =>
        checkbox({
          message: "Which test cases?",
          choices: options.map((tc) => ({
            name: `${tc.name}  (${tc.category})`,
            value: tc.id,
          })),
          required: true,
          loop: false,
        }),
      );
      testCaseIds = picked;
    }
  }

  const requestedModel = opts.model ?? null;
  opts.model = DEFAULT_EVAL_MODEL_ID;

  if (interactive && !isJsonMode()) {
    const summaryLines: Array<[string, string]> = [
      ["Stage", ctx.stage],
      ["Tenant", ctx.tenantSlug],
      ["Target", "Default Agent template"],
    ];
    if (requestedModel && requestedModel !== DEFAULT_EVAL_MODEL_ID)
      summaryLines.push(["Ignored Model", requestedModel]);
    if (opts.model) summaryLines.push(["Model", opts.model]);
    if (categories && categories.length)
      summaryLines.push(["Categories", categories.join(", ")]);
    if (testCaseIds && testCaseIds.length)
      summaryLines.push(["Test cases", `${testCaseIds.length} picked`]);
    if (opts.all && !categories?.length && !testCaseIds?.length)
      summaryLines.push(["Scope", "all enabled test cases"]);
    printKeyValue(summaryLines);

    const proceed = await promptOrExit(() =>
      confirm({ message: "Start run?", default: true }),
    );
    if (!proceed) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }

  const mutRes = await gqlMutate(ctx.client, StartEvalRunDoc, {
    tenantId: ctx.tenantId,
    input: {
      model: opts.model ?? null,
      categories: categories ?? null,
      testCaseIds: testCaseIds ?? null,
    },
  });

  const run = mutRes.startEvalRun;

  if (isJsonMode()) {
    printJson({
      runId: run.id,
      status: run.status,
      model: run.model,
      categories: run.categories,
    });
  } else {
    printSuccess(`Started eval run ${run.id} (status: ${run.status}).`);
  }

  if (!opts.watch) return;

  const timeoutSec = Number.parseInt(opts.timeout ?? "900", 10);
  await pollUntilTerminal(ctx.client, run.id, 3, timeoutSec);
}

async function pollUntilTerminal(
  client: import("@urql/core").Client,
  runId: string,
  intervalSec: number,
  timeoutSec: number,
): Promise<void> {
  const deadline = Date.now() + timeoutSec * 1000;
  const spinner = isJsonMode()
    ? null
    : ora({ text: "Waiting for run to complete…" }).start();
  try {
    while (Date.now() < deadline) {
      const data = await gqlQuery(client, EvalRunDoc, { id: runId });
      const run = data.evalRun;
      if (!run) {
        if (spinner) spinner.fail("Run disappeared from the database.");
        process.exit(1);
      }
      if (spinner) {
        spinner.text = `status=${run.status}  ${run.passed}/${run.totalTests} passed  (${fmtPercent(run.passRate)})`;
      }
      if (isTerminalStatus(run.status)) {
        if (spinner) {
          if (run.status === "completed")
            spinner.succeed(
              `completed — ${run.passed}/${run.totalTests} (${fmtPercent(run.passRate)})`,
            );
          else if (run.status === "failed")
            spinner.fail(`failed — ${run.errorMessage ?? "unknown error"}`);
          else spinner.warn("cancelled");
        }
        if (isJsonMode()) {
          printJson({
            runId: run.id,
            status: run.status,
            passed: run.passed,
            failed: run.failed,
            totalTests: run.totalTests,
            passRate: run.passRate,
            errorMessage: run.errorMessage,
          });
        }
        if (run.status === "completed") process.exit(0);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, intervalSec * 1000));
    }
    if (spinner) spinner.warn(`timeout after ${timeoutSec}s`);
    process.exit(2);
  } catch (err) {
    if (spinner) spinner.fail(err instanceof Error ? err.message : String(err));
    throw err;
  }
}
