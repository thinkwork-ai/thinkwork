import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import chalk from "chalk";
import { getAwsIdentity } from "../aws.js";
import { resolveTierDir, ensureInit, ensureWorkspace, runTerraform } from "../terraform.js";
import { loadEnvironment, listEnvironments, resolveTerraformDir } from "../environments.js";
import { printHeader, printSuccess, printError, printWarning } from "../ui.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { isCancellation } from "../lib/interactive.js";

function readTfVar(tfvarsPath: string, key: string): string | null {
  if (!existsSync(tfvarsPath)) return null;
  const content = readFileSync(tfvarsPath, "utf-8");
  // Support both quoted string values and bare bool/number values.
  const quoted = content.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
  if (quoted) return quoted[1];
  const bare = content.match(new RegExp(`^${key}\\s*=\\s*([^\\s#]+)`, "m"));
  return bare ? bare[1] : null;
}

/** Keys whose tfvars representation is a bare bool/number, not a quoted string. */
const BARE_KEYS = new Set(["enable_hindsight"]);

function setTfVar(tfvarsPath: string, key: string, value: string): void {
  if (!existsSync(tfvarsPath)) {
    throw new Error(`terraform.tfvars not found at ${tfvarsPath}`);
  }
  let content = readFileSync(tfvarsPath, "utf-8");
  const bare = BARE_KEYS.has(key);
  const newLine = bare ? `${key} = ${value}` : `${key} = "${value}"`;
  const existingRegex = new RegExp(`^${key}\\s*=\\s*(?:"[^"]*"|[^\\s#]+)`, "m");
  if (existingRegex.test(content)) {
    content = content.replace(existingRegex, newLine);
  } else {
    content += `\n${newLine}\n`;
  }
  writeFileSync(tfvarsPath, content);
}

function resolveTfvarsPath(stage: string): string {
  // Try environment registry first
  const tfDir = resolveTerraformDir(stage);
  if (tfDir) {
    const direct = `${tfDir}/terraform.tfvars`;
    if (existsSync(direct)) return direct;
  }
  // Fallback to old resolution
  const terraformDir = process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
  const cwd = resolveTierDir(terraformDir, stage, "app");
  return `${cwd}/terraform.tfvars`;
}

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("View or change stack configuration");

  // thinkwork config list [-s <stage>]
  config
    .command("list")
    .description("List all environments, or show config for a specific stage")
    .option("-s, --stage <name>", "Show config for a specific stage")
    .action((opts: { stage?: string }) => {
      if (opts.stage) {
        // Show config for a specific stage
        const env = loadEnvironment(opts.stage);
        if (!env) {
          printError(`Environment "${opts.stage}" not found. Run \`thinkwork init -s ${opts.stage}\` first.`);
          process.exit(1);
        }

        console.log("");
        console.log(chalk.bold.cyan(`  ⬡ ${env.stage}`));
        console.log(chalk.dim("  ─────────────────────────────────────"));
        console.log(`  ${chalk.bold("Region:")}          ${env.region}`);
        console.log(`  ${chalk.bold("Account:")}         ${env.accountId}`);
        console.log(`  ${chalk.bold("Database:")}        ${env.databaseEngine}`);
        console.log(`  ${chalk.bold("Memory:")}          managed (always on)${env.enableHindsight ? " + hindsight" : ""}`);
        console.log(`  ${chalk.bold("Terraform dir:")}   ${env.terraformDir}`);
        console.log(`  ${chalk.bold("Created:")}         ${env.createdAt}`);
        console.log(`  ${chalk.bold("Updated:")}         ${env.updatedAt}`);
        console.log(chalk.dim("  ─────────────────────────────────────"));

        // Also show tfvars if available
        const tfvarsPath = `${env.terraformDir}/terraform.tfvars`;
        if (existsSync(tfvarsPath)) {
          console.log("");
          console.log(chalk.dim("  terraform.tfvars:"));
          const content = readFileSync(tfvarsPath, "utf-8");
          for (const line of content.split("\n")) {
            if (line.trim() && !line.trim().startsWith("#")) {
              // Mask sensitive values
              const masked = line.replace(
                /^(db_password\s*=\s*)".*"/,
                '$1"********"'
              ).replace(
                /^(api_auth_secret\s*=\s*)".*"/,
                '$1"********"'
              ).replace(
                /^(google_oauth_client_secret\s*=\s*)".*"/,
                '$1"********"'
              );
              console.log(`  ${chalk.dim(masked)}`);
            }
          }
        }
        console.log("");
        return;
      }

      // List all environments
      const envs = listEnvironments();
      if (envs.length === 0) {
        console.log("");
        console.log("  No environments found.");
        console.log(`  Run ${chalk.cyan("thinkwork init -s <stage>")} to create one.`);
        console.log("");
        return;
      }

      console.log("");
      console.log(chalk.bold("  Environments"));
      console.log(chalk.dim("  ─────────────────────────────────────────────────────────────"));

      for (const env of envs) {
        const memBadge = env.enableHindsight
          ? chalk.magenta("managed+hindsight")
          : chalk.dim("managed");
        const dbBadge = env.databaseEngine === "rds-postgres"
          ? chalk.yellow("rds")
          : chalk.dim("aurora");

        console.log(
          `  ${chalk.bold.cyan(env.stage.padEnd(16))}` +
          `${env.region.padEnd(14)}` +
          `${env.accountId.padEnd(16)}` +
          `${dbBadge.padEnd(20)}` +
          `${memBadge}`
        );
      }

      console.log(chalk.dim("  ─────────────────────────────────────────────────────────────"));
      console.log(chalk.dim(`  ${envs.length} environment(s)`));
      console.log("");
      console.log(`  Show details: ${chalk.cyan("thinkwork config list -s <stage>")}`);
      console.log("");
    });

  // thinkwork config get <key> -s <stage>
  config
    .command("get <key>")
    .description("Get a configuration value (e.g. enable-hindsight). Prompts for stage in a TTY when omitted.")
    .option("-s, --stage <name>", "Deployment stage")
    .action(async (key: string, opts: { stage?: string }) => {
      let stage: string;
      try {
        stage = await resolveStage({ flag: opts.stage });
      } catch (err) {
        if (isCancellation(err)) return;
        throw err;
      }

      const tfvarsPath = resolveTfvarsPath(stage);
      const tfKey = key.replace(/-/g, "_");
      const value = readTfVar(tfvarsPath, tfKey);

      if (value === null) {
        printWarning(`${key} is not set in ${tfvarsPath}`);
      } else {
        console.log(`  ${key} = ${value}`);
      }
    });

  // thinkwork config set <key> <value> -s <stage> [--apply]
  config
    .command("set <key> <value>")
    .description("Set a configuration value and optionally deploy. Prompts for stage in a TTY when omitted.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("--apply", "Run terraform apply after changing the value")
    .action(async (key: string, value: string, opts: { stage?: string; apply?: boolean }) => {
      let stage: string;
      try {
        stage = await resolveStage({ flag: opts.stage });
      } catch (err) {
        if (isCancellation(err)) return;
        throw err;
      }

      let tfKey = key.replace(/-/g, "_");
      let tfValue = value;

      if (tfKey === "memory_engine") {
        if (value !== "managed" && value !== "hindsight") {
          printError(`Invalid memory engine "${value}". Must be 'managed' or 'hindsight'. Note: memory_engine is deprecated — use enable_hindsight instead.`);
          process.exit(1);
        }
        printWarning("memory_engine is deprecated — translating to enable_hindsight. Managed memory is always on.");
        tfKey = "enable_hindsight";
        tfValue = value === "hindsight" ? "true" : "false";
      }

      if (tfKey === "enable_hindsight" && tfValue !== "true" && tfValue !== "false") {
        printError(`Invalid enable_hindsight value "${tfValue}". Must be 'true' or 'false'.`);
        process.exit(1);
      }

      const identity = getAwsIdentity();
      printHeader("config set", stage, identity);

      const tfvarsPath = resolveTfvarsPath(stage);
      const oldValue = readTfVar(tfvarsPath, tfKey);
      setTfVar(tfvarsPath, tfKey, tfValue);

      console.log(`  ${tfKey}: ${oldValue ?? "(unset)"} → ${tfValue}`);

      if (opts.apply) {
        const tfDir = resolveTerraformDir(stage);
        if (!tfDir) {
          printError("Cannot find terraform directory. Run `thinkwork init` first.");
          process.exit(1);
        }

        console.log("");
        console.log("  Applying configuration change...");

        await ensureInit(tfDir);
        await ensureWorkspace(tfDir, stage);

        const code = await runTerraform(tfDir, [
          "apply",
          "-auto-approve",
          `-var=stage=${stage}`,
        ]);
        if (code !== 0) {
          printError(`Deploy failed (exit ${code})`);
          process.exit(code);
        }
        printSuccess(`Configuration applied: ${tfKey} = ${tfValue}`);
      } else {
        printSuccess(`Configuration updated: ${tfKey} = ${tfValue}`);
        printWarning("Run with --apply to deploy the change, or run 'thinkwork deploy' separately.");
      }
    });
}
