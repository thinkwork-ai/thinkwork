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
import {
  type BackendTarget,
  backendConfigArgs,
  backendMatches,
  detectLocalStateOrphanRisk,
  readRecordedBackend,
} from "./lib/state-backend.js";

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
 * Resolve the root directory that contains Thinkwork Terraform layouts.
 *
 * CLI commands may be run from nested workspace directories such as apps/mobile.
 * In that case, process.cwd() is not the Terraform root; walk upward looking for
 * a repo-local terraform/ directory before falling back to the current directory.
 */
export function resolveTerraformRoot(startDir = process.cwd()): string {
  const configured = process.env.THINKWORK_TERRAFORM_DIR;
  if (configured) return configured;

  let current = path.resolve(startDir);
  while (true) {
    if (isTerraformRoot(current)) return current;

    const nestedTerraform = path.join(current, "terraform");
    if (isTerraformRoot(nestedTerraform)) return nestedTerraform;

    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

function isTerraformRoot(dir: string): boolean {
  return (
    existsSync(path.join(dir, "examples", "greenfield")) ||
    existsSync(path.join(dir, "environments")) ||
    existsSync(path.join(dir, "main.tf"))
  );
}

/**
 * Resolves the working directory for a given tier.
 * Looks for environments/<stage>/<tier>/ first, falls back to examples/greenfield/.
 */
export function resolveTierDir(
  terraformDir: string,
  stage: string,
  tier: string,
): string {
  // Check for environment-specific dir first
  const envDir = path.join(terraformDir, "environments", stage, tier);
  if (existsSync(envDir)) {
    return envDir;
  }
  // Flat init-scaffolded layout BEFORE the greenfield example: `thinkwork
  // init` copies examples/ into the scaffold as reference material, so a
  // scaffolded dir matches both. Resolving greenfield first ran terraform in
  // the bundled example — which has no terraform.tfvars (the npm bundler
  // strips them) — failing every scaffolded deploy with "No value for
  // required variable" (harness ledger, cycle 1). The repo layout is
  // unaffected: its terraform/ root has no main.tf + tfvars pair.
  const flat = path.join(terraformDir);
  if (
    existsSync(path.join(flat, "main.tf")) &&
    existsSync(path.join(flat, "terraform.tfvars"))
  ) {
    return flat;
  }
  // Check for greenfield example (repo layout)
  const greenfield = path.join(terraformDir, "examples", "greenfield");
  if (existsSync(greenfield)) {
    return greenfield;
  }
  // Flat layout without tfvars yet (main.tf only)
  if (existsSync(path.join(flat, "main.tf"))) {
    return flat;
  }
  // Check CWD/terraform/ (user ran `thinkwork init` and is in the project root)
  const cwdTf = path.join(process.cwd(), "terraform");
  if (existsSync(path.join(cwdTf, "main.tf"))) {
    return cwdTf;
  }
  // No recognizable layout: fail loudly rather than applying terraform against
  // an arbitrary directory (a typo'd stage or wrong CWD must not reach apply).
  throw new Error(
    `No Terraform layout found for stage "${stage}" (tier "${tier}").\n` +
      `  Looked for:\n` +
      `    - ${envDir}\n` +
      `    - ${greenfield}\n` +
      `    - ${path.join(flat, "main.tf")}\n` +
      `    - ${path.join(cwdTf, "main.tf")}\n` +
      `  Run \`thinkwork init -s ${stage}\` to scaffold an environment, or run from its directory.`,
  );
}

/** True when this directory is the init-scaffolded flat layout (not the repo greenfield). */
export function isInitScaffoldedLayout(cwd: string): boolean {
  return (
    existsSync(path.join(cwd, "main.tf")) &&
    !cwd.endsWith(path.join("examples", "greenfield")) &&
    existsSync(path.join(cwd, "modules"))
  );
}

/**
 * Ensures the Terraform workspace matches the stage name.
 * Creates the workspace if it doesn't exist.
 */
export async function ensureWorkspace(
  cwd: string,
  stage: string,
): Promise<void> {
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
      else
        reject(
          new Error(
            `terraform ${args.join(" ")} failed (exit ${code}): ${stderr}`,
          ),
        );
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
 *
 * With a `backend` target, init receives `-backend-config` args. Terraform
 * only applies backend config during init, and the historical short-circuit
 * ("`.terraform/` exists → skip") would leave a backend change silently inert
 * — so when the recorded backend mismatches the target, this re-runs
 * `terraform init -reconfigure`. If real local state would be orphaned by the
 * switch, it fails loudly and names `-migrate-state` instead of proceeding.
 */
export async function ensureInit(
  cwd: string,
  backend?: BackendTarget,
): Promise<void> {
  const dotTerraform = path.join(cwd, ".terraform");
  const backendArgs = backend ? backendConfigArgs(backend) : [];

  if (!existsSync(dotTerraform)) {
    const code = await runTerraform(cwd, ["init", ...backendArgs]);
    if (code !== 0) {
      throw new Error("terraform init failed");
    }
    return;
  }

  if (!backend) return;

  const recorded = readRecordedBackend(cwd);
  if (backendMatches(recorded, backend)) return;

  if (detectLocalStateOrphanRisk(cwd)) {
    throw new Error(
      `This directory has local Terraform state with resources, but the deploy now targets the remote backend s3://${backend.bucket}/${backend.key}.\n` +
        `  Switching with -reconfigure would orphan that state. Migrate it first:\n` +
        `    terraform init -migrate-state ${backendConfigArgs(backend).join(" ")}\n` +
        `  (run inside ${cwd})`,
    );
  }

  console.log(
    `  Backend changed (recorded: ${recorded ? `${recorded.type}${recorded.bucket ? ` s3://${recorded.bucket}/${recorded.key}` : ""}` : "none"} → s3://${backend.bucket}/${backend.key}); re-running terraform init -reconfigure`,
  );
  const code = await runTerraform(cwd, [
    "init",
    "-reconfigure",
    ...backendArgs,
  ]);
  if (code !== 0) {
    throw new Error("terraform init -reconfigure failed");
  }
}

/** Read a single `terraform output -raw` value. */
export function terraformOutput(cwd: string, key: string): Promise<string> {
  return runTerraformRaw(cwd, ["output", "-raw", key]).then((v) => v.trim());
}

/**
 * Run terraform with live output AND a captured transcript, so callers can
 * pattern-match failures (e.g. stale state locks) without losing streaming UX.
 */
export function runTerraformTee(
  cwd: string,
  args: string[],
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    console.log(`\n  → terraform ${args.join(" ")}\n`);

    const proc = spawn("terraform", args, {
      cwd,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let output = "";
    proc.stdout.on("data", (d: Buffer) => {
      output += d.toString();
      process.stdout.write(d);
    });
    proc.stderr.on("data", (d: Buffer) => {
      output += d.toString();
      process.stderr.write(d);
    });
    proc.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}
