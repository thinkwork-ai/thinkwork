import { Command } from "commander";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAwsIdentity } from "../aws.js";
import {
  resolveTierDir,
  resolveTerraformRoot,
  ensureInit,
  ensureWorkspace,
} from "../terraform.js";
import { printHeader, printSuccess, printError } from "../ui.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { isCancellation } from "../lib/interactive.js";

/**
 * Run terraform output to get a value.
 */
function getTerraformOutput(cwd: string, key: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("terraform", ["output", "-raw", key], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`terraform output ${key} failed (exit ${code})`));
    });
  });
}

/**
 * Run a shell script with live output.
 */
function runScript(scriptPath: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("bash", [scriptPath, ...args], {
      stdio: "inherit",
    });
    proc.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Seed workspace defaults for a stage (shared by the bootstrap command and
 * the deploy tail — harness cycle-7: a fresh deploy must not require a
 * separate manual bootstrap step to pass verification).
 */
export async function runWorkspaceBootstrap(
  cwd: string,
  stage: string,
): Promise<void> {
  const bucket = await getTerraformOutput(cwd, "bucket_name");
  const dbEndpoint = await getTerraformOutput(cwd, "db_cluster_endpoint");
  const secretArn = await getTerraformOutput(cwd, "db_secret_arn");
  const { execSync } = await import("node:child_process");
  const secretJson = execSync(
    `aws secretsmanager get-secret-value --secret-id "${secretArn}" --query SecretString --output text`,
    { encoding: "utf-8" },
  ).trim();
  const secret = JSON.parse(secretJson) as { password: string };
  const databaseUrl = `postgresql://thinkwork_admin:${encodeURIComponent(secret.password)}@${dbEndpoint}:5432/thinkwork?sslmode=no-verify`;

  const here = dirname(fileURLToPath(import.meta.url));
  const terraformDir = resolveTerraformRoot();
  const candidates = [
    resolve(here, "scripts/bootstrap-workspace.sh"),
    resolve(terraformDir, "scripts/bootstrap-workspace.sh"),
    resolve(terraformDir, "..", "scripts/bootstrap-workspace.sh"),
  ];
  const scriptPath = candidates.find((c) => existsSync(c));
  if (!scriptPath) {
    throw new Error(
      `bootstrap-workspace.sh not found (looked in the CLI bundle and ${terraformDir}). ` +
        "Reinstall the CLI: npm install -g thinkwork-cli@latest",
    );
  }
  const code = await runScript(scriptPath, [stage, bucket, databaseUrl]);
  if (code !== 0) {
    throw new Error(`Workspace bootstrap failed (exit ${code}).`);
  }
}

export function registerBootstrapCommand(program: Command): void {
  program
    .command("bootstrap")
    .description(
      "Seed workspace defaults and per-tenant workspace files for a stage. Prompts for stage in a TTY when omitted.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .action(async (opts: { stage?: string }) => {
      let stage: string;
      try {
        stage = await resolveStage({ flag: opts.stage });
      } catch (err) {
        if (isCancellation(err)) return;
        throw err;
      }

      const identity = getAwsIdentity();
      printHeader("bootstrap", stage, identity);

      const terraformDir = resolveTerraformRoot();
      const cwd = resolveTierDir(terraformDir, stage, "app");

      await ensureInit(cwd);
      await ensureWorkspace(cwd, stage);

      // Read outputs from terraform state
      let bucket: string;
      let dbEndpoint: string;
      let dbPassword: string;
      try {
        bucket = await getTerraformOutput(cwd, "bucket_name");
        dbEndpoint = await getTerraformOutput(cwd, "db_cluster_endpoint");
        // Get password from secrets manager
        const secretArn = await getTerraformOutput(cwd, "db_secret_arn");
        const { execSync } = await import("node:child_process");
        const secretJson = execSync(
          `aws secretsmanager get-secret-value --secret-id "${secretArn}" --query SecretString --output text`,
          { encoding: "utf-8" },
        ).trim();
        const secret = JSON.parse(secretJson);
        dbPassword = secret.password;
      } catch (err) {
        printError(`Failed to read terraform outputs: ${err}`);
        process.exit(1);
      }

      const databaseUrl = `postgresql://thinkwork_admin:${encodeURIComponent(dbPassword)}@${dbEndpoint}:5432/thinkwork?sslmode=no-verify`;

      // Bundled copy first (npm/brew installs), then repo-relative (checkout)
      const here = dirname(fileURLToPath(import.meta.url));
      const candidates = [
        resolve(here, "scripts/bootstrap-workspace.sh"),
        resolve(terraformDir, "scripts/bootstrap-workspace.sh"),
        resolve(terraformDir, "..", "scripts/bootstrap-workspace.sh"),
      ];
      const scriptPath = candidates.find((c) => existsSync(c));
      if (!scriptPath) {
        printError(
          `bootstrap-workspace.sh not found (looked in the CLI bundle and ${terraformDir}). ` +
            "Reinstall the CLI: npm install -g thinkwork-cli@latest",
        );
        process.exit(1);
      }

      const code = await runScript(scriptPath, [stage, bucket, databaseUrl]);
      if (code !== 0) {
        printError(`Bootstrap failed (exit ${code})`);
        process.exit(code);
      }

      printSuccess("Bootstrap complete");
    });
}
