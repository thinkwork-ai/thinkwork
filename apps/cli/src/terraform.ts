/**
 * Thin Terraform wrapper — spawns `terraform` as a child process with the
 * correct -chdir, workspace, and -var-file arguments.
 *
 * This is NOT a second deployment engine. The value is standardization and
 * safety, not abstraction. Every Terraform command is visible in the output.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface TerraformOptions {
  /** Stage name (maps to Terraform workspace) */
  stage: string;
  /** Component tier (foundation | data | app) */
  tier: string;
  /** Path to the root Terraform directory (where modules/ and examples/ live) */
  terraformDir: string;
  /** Extra arguments to pass to terraform */
  extraArgs?: string[];
}

/**
 * Resolves the working directory for a given tier.
 * Looks for environments/<stage>/<tier>/ first, falls back to examples/greenfield/.
 */
export function resolveTierDir(terraformDir: string, stage: string, tier: string): string {
  // Check for environment-specific dir first
  const envDir = path.join(terraformDir, "environments", stage, tier);
  if (existsSync(envDir)) {
    return envDir;
  }
  // Fall back to greenfield example (single-state, all tiers)
  return path.join(terraformDir, "examples", "greenfield");
}

/**
 * Ensures the Terraform workspace matches the stage name.
 * Creates the workspace if it doesn't exist.
 */
export async function ensureWorkspace(cwd: string, stage: string): Promise<void> {
  // List existing workspaces
  const list = await runTerraformRaw(cwd, ["workspace", "list"]);
  const workspaces = list
    .split("\n")
    .map((l) => l.replace("*", "").trim())
    .filter(Boolean);

  if (!workspaces.includes(stage)) {
    await runTerraformRaw(cwd, ["workspace", "new", stage]);
  } else {
    await runTerraformRaw(cwd, ["workspace", "select", stage]);
  }
}

/**
 * Run a terraform command silently and return stdout.
 */
function runTerraformRaw(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("terraform", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`terraform ${args.join(" ")} failed (exit ${code}): ${stderr}`));
    });
  });
}

/**
 * Run a terraform command with live stdout/stderr passthrough.
 * Returns the exit code.
 */
export function runTerraform(cwd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    console.log(`\n  → terraform ${args.join(" ")}\n`);

    const proc = spawn("terraform", args, {
      cwd,
      stdio: "inherit",
    });

    proc.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Run terraform init if not already initialized.
 */
export async function ensureInit(cwd: string): Promise<void> {
  const dotTerraform = path.join(cwd, ".terraform");
  if (!existsSync(dotTerraform)) {
    const code = await runTerraform(cwd, ["init"]);
    if (code !== 0) {
      throw new Error("terraform init failed");
    }
  }
}
