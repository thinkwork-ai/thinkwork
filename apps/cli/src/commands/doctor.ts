import { Command } from "commander";
import chalk from "chalk";
import { printHeader } from "../ui.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { isCancellation } from "../lib/interactive.js";
import { doctorChecks, runChecks } from "../lib/checks.js";

// Re-exported for compatibility: the check implementations and their pure
// evaluators live in lib/checks.ts (shared with deploy's preflight, KTD-4).
export {
  DOCTOR_BEDROCK_PROBE_MODEL_ID,
  MIN_LAMBDA_CONCURRENT_EXECUTIONS,
  evaluateBedrockProbe,
  evaluateLambdaConcurrency,
} from "../lib/checks.js";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description(
      "Check AWS account prerequisites for a Thinkwork deployment. Prompts for stage in a TTY when omitted.",
    )
    .option("-p, --profile <name>", "AWS profile")
    .option("-s, --stage <name>", "Deployment stage")
    .action(async (opts: { stage?: string }) => {
      let stage: string;
      try {
        stage = await resolveStage({ flag: opts.stage });
      } catch (err) {
        if (isCancellation(err)) return;
        throw err;
      }

      printHeader("doctor", stage);

      const summary = await runChecks(doctorChecks());
      for (const { name, result } of summary.results) {
        const icon = result.pass ? chalk.green("✓") : chalk.red("✗");
        const detail = result.pass
          ? chalk.dim(result.detail)
          : chalk.yellow(result.detail);
        console.log(`  ${icon} ${name}  ${detail}`);
      }

      if (summary.passed && summary.warnings.length === 0) {
        console.log(`\n  ${chalk.green.bold("All checks passed.")}`);
      } else if (summary.passed) {
        console.log(
          `\n  ${chalk.green.bold("All blocking checks passed.")} Warnings above are tracked, not blocking.`,
        );
      } else {
        console.log(
          `\n  ${chalk.yellow.bold("Some checks failed.")} Fix the issues above before deploying.`,
        );
      }
      process.exit(summary.passed ? 0 : 1);
    });
}
