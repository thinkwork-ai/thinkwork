/**
 * CLI output formatting — spinners, colors, progress indicators.
 */

import chalk from "chalk";
import ora, { type Ora } from "ora";

/** Tier display names and icons */
const TIER_LABELS: Record<string, string> = {
  foundation: "Foundation",
  data: "Data",
  app: "App",
};

/**
 * Print a branded header at the start of a command.
 */
export function printHeader(command: string, stage: string, identity?: { account: string; region: string } | null): void {
  console.log("");
  console.log(chalk.bold.cyan("  ⬡ Thinkwork") + chalk.dim(` — ${command}`));
  console.log(chalk.dim(`  Stage: ${chalk.white(stage)}`));
  if (identity) {
    console.log(chalk.dim(`  AWS:   ${chalk.white(identity.account)} / ${chalk.white(identity.region)}`));
  }
  console.log("");
}

/**
 * Print a tier progress header.
 * Example: [1/3] Foundation
 */
export function printTierHeader(tier: string, index: number, total: number): void {
  const label = TIER_LABELS[tier] ?? tier;
  const progress = chalk.dim(`[${index + 1}/${total}]`);
  console.log(`  ${progress} ${chalk.bold(label)}`);
}

/**
 * Create a spinner for a long-running Terraform operation.
 */
export function createSpinner(text: string): Ora {
  return ora({
    text,
    prefixText: "  ",
    color: "cyan",
  });
}

/**
 * Print a success message.
 */
export function printSuccess(message: string): void {
  console.log(`\n  ${chalk.green("✓")} ${chalk.bold(message)}`);
}

/**
 * Print an error message.
 */
export function printError(message: string): void {
  console.log(`\n  ${chalk.red("✗")} ${chalk.bold.red(message)}`);
}

/**
 * Print the "no API session / no tenant cached" error with the actual fix on
 * its own line, not buried in a comma list. `hasSession` distinguishes "you
 * haven't done the API-side login yet" from "you logged in but have no tenant
 * cached on the session."
 */
export function printMissingApiSessionError(stage: string, hasSession: boolean): void {
  if (!hasSession) {
    printError(`No API session for stage "${stage}".`);
    console.log("");
    console.log(`  ${chalk.bold("To fix:")}  thinkwork login --stage ${stage}`);
    console.log(
      chalk.dim(
        `  (the deploy-side \`thinkwork login\` only configures an AWS profile —\n   it does NOT open an API session.)`,
      ),
    );
    console.log("");
  } else {
    printError(`Session for stage "${stage}" has no tenant cached.`);
    console.log("");
    console.log(`  ${chalk.bold("To fix:")}  thinkwork login --stage ${stage}`);
    console.log(
      chalk.dim(
        `  Or pass --tenant <slug>, or set THINKWORK_TENANT.`,
      ),
    );
    console.log("");
  }
}

/**
 * Print a warning message.
 */
export function printWarning(message: string): void {
  console.log(`  ${chalk.yellow("⚠")} ${message}`);
}

/**
 * Print a summary table after deploy/destroy.
 */
export function printSummary(command: string, stage: string, tiers: string[], startTime: number): void {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("");
  console.log(chalk.dim("  ─────────────────────────────────"));
  console.log(`  ${chalk.bold("Command:")}  ${command}`);
  console.log(`  ${chalk.bold("Stage:")}    ${stage}`);
  console.log(`  ${chalk.bold("Tiers:")}    ${tiers.map(t => TIER_LABELS[t] ?? t).join(" → ")}`);
  console.log(`  ${chalk.bold("Time:")}     ${elapsed}s`);
  console.log(chalk.dim("  ─────────────────────────────────"));
}
