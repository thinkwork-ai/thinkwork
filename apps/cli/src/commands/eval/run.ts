import { select, checkbox, confirm, input } from "@inquirer/prompts";
import ora from "ora";
import { gqlQuery, gqlMutate } from "../../lib/gql-client.js";
import {
  isInteractive,
  requireTty,
  promptOrExit,
} from "../../lib/interactive.js";
import {
  isJsonMode,
  printJson,
  printKeyValue,
  logStderr,
} from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import {
  ComputersForEvalDoc,
  EvalTestCasesDoc,
  EvalRunDoc,
  StartEvalRunDoc,
} from "./gql.js";
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

export async function runEvalRun(opts: RunOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);
  const interactive = isInteractive();

  let computerId = opts.computer ?? null;
  let categories = opts.category ?? null;
  let testCaseIds = opts.testCase ?? null;

  const scopeSatisfied =
    (testCaseIds && testCaseIds.length > 0) ||
    (categories && categories.length > 0) ||
    opts.all === true;

  if (!computerId || !scopeSatisfied) {
    if (!interactive) {
      const missing: string[] = [];
      if (!computerId) missing.push("--computer");
      if (!scopeSatisfied)
        missing.push("one of --all | --category | --test-case");
      printError(
        `Missing required flag(s) in non-interactive session: ${missing.join(", ")}.`,
      );
      process.exit(1);
    }
  }

  if (!computerId) {
    const data = await gqlQuery(ctx.client, ComputersForEvalDoc, {
      tenantId: ctx.tenantId,
    });
    const computers = (data.computers ?? []).filter(
      (computer) => computer.runtimeStatus === "RUNNING",
    );
    if (computers.length === 0) {
      printError(
        "No running Computers found for this tenant. Start a Computer first.",
      );
      process.exit(1);
    }
    requireTty("Computer");
    computerId = await promptOrExit(() =>
      select({
        message: "Computer to run against?",
        choices: computers.map((computer) => ({
          name: `${computer.name}  (${computer.slug})`,
          value: computer.id,
        })),
        loop: false,
      }),
    );
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

  if (!opts.model && interactive) {
    const entered = await promptOrExit(() =>
      input({
        message: "Model override? (blank for Computer default)",
        default: "",
      }),
    );
    if (entered.trim()) opts.model = entered.trim();
  }

  if (interactive && !isJsonMode()) {
    const summaryLines: Array<[string, string]> = [
      ["Stage", ctx.stage],
      ["Tenant", ctx.tenantSlug],
      ["Computer", computerId],
    ];
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
      computerId,
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
