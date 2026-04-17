import ora from "ora";
import { gqlQuery } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { EvalRunDoc } from "./gql.js";
import {
  resolveEvalContext,
  fmtPercent,
  isTerminalStatus,
  type EvalCliOptions,
} from "./helpers.js";

interface WatchOptions extends EvalCliOptions {
  interval?: string;
  timeout?: string;
}

export async function runEvalWatch(runId: string, opts: WatchOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);
  const intervalSec = Number.parseInt(opts.interval ?? "3", 10);
  const timeoutSec = Number.parseInt(opts.timeout ?? "900", 10);
  const deadline = Date.now() + timeoutSec * 1000;

  const spinner = isJsonMode() ? null : ora({ text: `Watching run ${runId}…` }).start();
  try {
    while (Date.now() < deadline) {
      const data = await gqlQuery(ctx.client, EvalRunDoc, { id: runId });
      const run = data.evalRun;
      if (!run) {
        if (spinner) spinner.fail(`Run ${runId} not found.`);
        process.exit(1);
      }
      if (spinner) {
        spinner.text = `status=${run.status}  ${run.passed}/${run.totalTests} passed  (${fmtPercent(run.passRate)})`;
      }
      if (isTerminalStatus(run.status)) {
        if (spinner) {
          if (run.status === "completed")
            spinner.succeed(`completed — ${run.passed}/${run.totalTests} (${fmtPercent(run.passRate)})`);
          else if (run.status === "failed") spinner.fail(`failed — ${run.errorMessage ?? "unknown error"}`);
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
        process.exit(run.status === "completed" ? 0 : 1);
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
