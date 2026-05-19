/**
 * Environment registry — tracks all initialized Thinkwork stages.
 *
 * Each environment gets a directory at ~/.thinkwork/environments/<stage>/
 * containing config.json (metadata) and a pointer to the terraform directory.
 * This lets all CLI commands find the right terraform state without the user
 * having to cd into the right directory or pass --dir every time.
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface EnvironmentConfig {
  stage: string;
  region: string;
  accountId: string;
  terraformDir: string;
  databaseEngine: string;
  /** Whether the optional Hindsight memory add-on is enabled (managed memory is always on). */
  enableHindsight: boolean;
  /** @deprecated Use `enableHindsight` instead. Kept for backwards-compat reads of existing config.json files. */
  memoryEngine?: string;
  createdAt: string;
  updatedAt: string;
}

const THINKWORK_HOME = join(homedir(), ".thinkwork");
const ENVIRONMENTS_DIR = join(THINKWORK_HOME, "environments");
const ENTERPRISE_DEPLOYMENTS_DIR = join(
  THINKWORK_HOME,
  "enterprise-deployments",
);

export interface EnterpriseDeploymentConfig {
  customerSlug: string;
  repository: string;
  targetDir: string;
  checkoutDir?: string;
  defaultStage?: string;
  repositoryDefaultBranch?: string;
  lastWorkflowRunId?: string;
  lastWorkflowUrl?: string;
  accountId: string;
  region: string;
  stages: string[];
  artifactBucket: string;
  stateBucket: string;
  lockTable: string;
  releaseVersion: string;
  releaseManifestUrl: string;
  updatedAt: string;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Save an environment configuration.
 */
export function saveEnvironment(config: EnvironmentConfig): void {
  ensureDir(ENVIRONMENTS_DIR);
  const envDir = join(ENVIRONMENTS_DIR, config.stage);
  ensureDir(envDir);
  writeFileSync(
    join(envDir, "config.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
}

export function saveEnterpriseDeployment(
  config: EnterpriseDeploymentConfig,
): void {
  ensureDir(ENTERPRISE_DEPLOYMENTS_DIR);
  writeFileSync(
    join(ENTERPRISE_DEPLOYMENTS_DIR, `${config.customerSlug}.json`),
    JSON.stringify(config, null, 2) + "\n",
  );
}

export function loadEnterpriseDeployment(
  customerSlug: string,
): EnterpriseDeploymentConfig | null {
  const configPath = join(ENTERPRISE_DEPLOYMENTS_DIR, `${customerSlug}.json`);
  if (!existsSync(configPath)) return null;
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

export function listEnterpriseDeployments(): EnterpriseDeploymentConfig[] {
  if (!existsSync(ENTERPRISE_DEPLOYMENTS_DIR)) return [];
  return readdirSync(ENTERPRISE_DEPLOYMENTS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      return JSON.parse(
        readFileSync(join(ENTERPRISE_DEPLOYMENTS_DIR, name), "utf-8"),
      );
    })
    .sort((a, b) => a.customerSlug.localeCompare(b.customerSlug));
}

/**
 * Load an environment configuration by stage name.
 */
export function loadEnvironment(stage: string): EnvironmentConfig | null {
  const configPath = join(ENVIRONMENTS_DIR, stage, "config.json");
  if (!existsSync(configPath)) return null;
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

/**
 * List all registered environments.
 */
export function listEnvironments(): EnvironmentConfig[] {
  if (!existsSync(ENVIRONMENTS_DIR)) return [];
  return readdirSync(ENVIRONMENTS_DIR)
    .filter((name) => {
      return existsSync(join(ENVIRONMENTS_DIR, name, "config.json"));
    })
    .map((name) => {
      return JSON.parse(
        readFileSync(join(ENVIRONMENTS_DIR, name, "config.json"), "utf-8"),
      );
    })
    .sort((a, b) => a.stage.localeCompare(b.stage));
}

/**
 * Resolve the terraform working directory for a stage.
 * Checks: environment registry → CWD/terraform → THINKWORK_TERRAFORM_DIR env.
 */
export function resolveTerraformDir(stage: string): string | null {
  const env = loadEnvironment(stage);
  if (env?.terraformDir && existsSync(env.terraformDir)) {
    return env.terraformDir;
  }

  // Fallback to env var or CWD
  const envVar = process.env.THINKWORK_TERRAFORM_DIR;
  if (envVar && existsSync(envVar)) return envVar;

  const cwdTf = join(process.cwd(), "terraform");
  if (existsSync(join(cwdTf, "main.tf"))) return cwdTf;

  return null;
}

/**
 * Get the environments home directory path.
 */
export function getEnvironmentsDir(): string {
  return ENVIRONMENTS_DIR;
}
