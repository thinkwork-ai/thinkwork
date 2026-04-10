import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { validateStage } from "../config.js";
import { getAwsIdentity } from "../aws.js";
import { resolveTierDir, ensureInit, ensureWorkspace, runTerraform } from "../terraform.js";
import { printHeader, printSuccess, printError, printWarning } from "../ui.js";

const VALID_MEMORY_ENGINES = ["managed", "hindsight"] as const;

/**
 * Read the current value of a tfvar from the terraform.tfvars file.
 */
function readTfVar(tfvarsPath: string, key: string): string | null {
  if (!existsSync(tfvarsPath)) return null;
  const content = readFileSync(tfvarsPath, "utf-8");
  const match = content.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match ? match[1] : null;
}

/**
 * Set a tfvar value in the terraform.tfvars file.
 */
function setTfVar(tfvarsPath: string, key: string, value: string): void {
  if (!existsSync(tfvarsPath)) {
    throw new Error(`terraform.tfvars not found at ${tfvarsPath}`);
  }
  let content = readFileSync(tfvarsPath, "utf-8");
  const regex = new RegExp(`^(${key}\\s*=\\s*)"[^"]*"`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `$1"${value}"`);
  } else {
    content += `\n${key} = "${value}"\n`;
  }
  writeFileSync(tfvarsPath, content);
}

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("View or change stack configuration");

  // thinkwork config get <key> -s <stage>
  config
    .command("get <key>")
    .description("Get a configuration value (e.g. memory-engine)")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .action((key: string, opts: { stage: string }) => {
      const stageCheck = validateStage(opts.stage);
      if (!stageCheck.valid) {
        printError(stageCheck.error!);
        process.exit(1);
      }

      const terraformDir = process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
      const cwd = resolveTierDir(terraformDir, opts.stage, "app");
      const tfvarsPath = `${cwd}/terraform.tfvars`;

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
    .description("Set a configuration value and optionally deploy (e.g. config set memory-engine hindsight)")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .option("--apply", "Run terraform apply after changing the value")
    .action(async (key: string, value: string, opts: { stage: string; apply?: boolean }) => {
      const stageCheck = validateStage(opts.stage);
      if (!stageCheck.valid) {
        printError(stageCheck.error!);
        process.exit(1);
      }

      // Validate known keys
      const tfKey = key.replace(/-/g, "_");
      if (tfKey === "memory_engine" && !VALID_MEMORY_ENGINES.includes(value as typeof VALID_MEMORY_ENGINES[number])) {
        printError(`Invalid memory engine "${value}". Must be: ${VALID_MEMORY_ENGINES.join(", ")}`);
        process.exit(1);
      }

      const identity = getAwsIdentity();
      printHeader("config set", opts.stage, identity);

      const terraformDir = process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
      const cwd = resolveTierDir(terraformDir, opts.stage, "app");
      const tfvarsPath = `${cwd}/terraform.tfvars`;

      const oldValue = readTfVar(tfvarsPath, tfKey);
      setTfVar(tfvarsPath, tfKey, value);

      console.log(`  ${key}: ${oldValue ?? "(unset)"} → ${value}`);

      if (opts.apply) {
        console.log("");
        console.log("  Applying configuration change...");

        await ensureInit(cwd);
        await ensureWorkspace(cwd, opts.stage);

        const code = await runTerraform(cwd, [
          "apply",
          "-auto-approve",
          `-var=stage=${opts.stage}`,
        ]);
        if (code !== 0) {
          printError(`Deploy failed (exit ${code})`);
          process.exit(code);
        }
        printSuccess(`Configuration applied: ${key} = ${value}`);
      } else {
        printSuccess(`Configuration updated: ${key} = ${value}`);
        printWarning("Run with --apply to deploy the change, or run 'thinkwork deploy' separately.");
      }
    });
}
