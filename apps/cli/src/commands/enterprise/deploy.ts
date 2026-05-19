import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { isProdLike, validateStage } from "../../config.js";
import {
  loadEnterpriseDeployment,
  type EnterpriseDeploymentConfig,
} from "../../environments.js";
import { confirm } from "../../prompt.js";
import {
  runEnterpriseBootstrap,
  type EnterpriseBootstrapOptions,
  type EnterpriseBootstrapResult,
} from "./bootstrap.js";

export const ENTERPRISE_DEPLOY_COMPONENTS = [
  "all",
  "foundation",
  "artifacts",
  "overlays",
  "smokes",
] as const;

export type EnterpriseDeployComponent =
  (typeof ENTERPRISE_DEPLOY_COMPONENTS)[number];

export interface EnterpriseDeployOptions {
  bootstrap?: boolean;
  customer?: string;
  repo?: string;
  createRepo?: boolean;
  checkoutDir?: string;
  wait?: boolean;
  localTerraform?: boolean;
  releaseVersion?: string;
  manifestUrl?: string;
  manifestSha256?: string;
  terraformModuleVersion?: string;
  stage?: string;
  component?: string;
  yes?: boolean;
}

export interface EnterpriseDeploymentRepoContext {
  repoRoot: string;
  customerSlug: string;
  stages: string[];
}

export interface EnterpriseDeployRequest {
  customerSlug: string;
  repository?: string;
  checkoutDir: string;
  stage: string;
  component: EnterpriseDeployComponent;
  bootstrap: boolean;
  wait: boolean;
  createRepo: boolean;
  registry?: EnterpriseDeploymentConfig;
  repoContext?: EnterpriseDeploymentRepoContext;
}

export type EnterpriseDeployResult =
  | {
      kind: "bootstrap";
      request: EnterpriseDeployRequest;
      bootstrap: EnterpriseBootstrapResult;
    }
  | {
      kind: "dispatch";
      request: EnterpriseDeployRequest;
    };

export interface EnterpriseDeployDependencies {
  cwd?: string;
  stdinIsTty?: boolean;
  loadDeployment?: (customerSlug: string) => EnterpriseDeploymentConfig | null;
  runBootstrap?: (
    options: EnterpriseBootstrapOptions,
  ) => Promise<EnterpriseBootstrapResult>;
  promptInput?: (message: string) => Promise<string>;
}

export function validateEnterpriseDeployComponent(component: string): {
  valid: boolean;
  error?: string;
} {
  if (
    !ENTERPRISE_DEPLOY_COMPONENTS.includes(
      component as EnterpriseDeployComponent,
    )
  ) {
    return {
      valid: false,
      error: `Invalid enterprise deploy component "${component}". Must be one of: ${ENTERPRISE_DEPLOY_COMPONENTS.join(", ")}`,
    };
  }
  return { valid: true };
}

export function findEnterpriseDeploymentRepo(
  startDir = process.cwd(),
): EnterpriseDeploymentRepoContext | null {
  let current = resolve(startDir);

  while (true) {
    const lockPath = join(current, "thinkwork.lock");
    const deploymentPath = join(current, "customer", "deployment.json");
    if (existsSync(lockPath) && existsSync(deploymentPath)) {
      const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
      const customerSlug =
        typeof deployment.customerSlug === "string"
          ? deployment.customerSlug
          : "";
      const stages =
        deployment.stages && typeof deployment.stages === "object"
          ? Object.keys(deployment.stages)
          : [];
      if (customerSlug) {
        return { repoRoot: current, customerSlug, stages };
      }
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function shouldUseEnterpriseDeploy(
  options: EnterpriseDeployOptions,
  deps: Pick<EnterpriseDeployDependencies, "cwd" | "loadDeployment"> = {},
): boolean {
  if (options.localTerraform) return false;
  if (options.bootstrap) return true;
  if (findEnterpriseDeploymentRepo(deps.cwd)) return true;
  if (!options.customer) return false;

  const loadDeployment = deps.loadDeployment ?? loadEnterpriseDeployment;
  return loadDeployment(options.customer) !== null;
}

export async function resolveEnterpriseDeployRequest(
  options: EnterpriseDeployOptions,
  deps: EnterpriseDeployDependencies = {},
): Promise<EnterpriseDeployRequest> {
  const cwd = deps.cwd ?? process.cwd();
  const repoContext = findEnterpriseDeploymentRepo(cwd);
  const loadDeployment = deps.loadDeployment ?? loadEnterpriseDeployment;
  const stdinIsTty = deps.stdinIsTty ?? process.stdin.isTTY;
  const component = options.component ?? "all";

  const componentCheck = validateEnterpriseDeployComponent(component);
  if (!componentCheck.valid) {
    throw new Error(componentCheck.error);
  }

  const customerSlug =
    options.customer ??
    repoContext?.customerSlug ??
    (await promptWhenInteractive(
      "Customer slug:",
      stdinIsTty,
      deps.promptInput,
      "Customer slug is required for enterprise deploy. Pass --customer <slug>.",
    ));
  const registry = loadDeployment(customerSlug);
  const stage =
    options.stage ?? registry?.defaultStage ?? repoContext?.stages[0] ?? "dev";
  const stageCheck = validateStage(stage);
  if (!stageCheck.valid) {
    throw new Error(stageCheck.error);
  }

  const repository =
    options.repo ??
    registry?.repository ??
    (options.bootstrap
      ? await promptWhenInteractive(
          "GitHub deployment repo (owner/name):",
          stdinIsTty,
          deps.promptInput,
          "GitHub repository is required for enterprise deploy bootstrap. Pass --repo <owner/name>.",
        )
      : undefined);
  const checkoutDir =
    options.checkoutDir ??
    registry?.checkoutDir ??
    registry?.targetDir ??
    repoContext?.repoRoot ??
    join(resolve(cwd), `${customerSlug}-thinkwork-deploy`);

  return {
    customerSlug,
    repository,
    checkoutDir: resolve(checkoutDir),
    stage,
    component: component as EnterpriseDeployComponent,
    bootstrap: options.bootstrap === true,
    wait: options.wait !== false,
    createRepo: options.createRepo === true,
    registry: registry ?? undefined,
    repoContext: repoContext ?? undefined,
  };
}

export async function runEnterpriseDeploy(
  options: EnterpriseDeployOptions,
  deps: EnterpriseDeployDependencies = {},
): Promise<EnterpriseDeployResult> {
  const request = await resolveEnterpriseDeployRequest(options, deps);

  if (!request.bootstrap) {
    throw new Error(
      "Enterprise CI deploy dispatch is not implemented yet. Run with --bootstrap for first-time setup or use `thinkwork enterprise bootstrap --dispatch`.",
    );
  }
  if (!request.repository) {
    throw new Error(
      "GitHub repository is required for enterprise deploy bootstrap. Pass --repo <owner/name>.",
    );
  }

  if (!options.yes) {
    const message = isProdLike(request.stage)
      ? `  Stage "${request.stage}" is production-like. Bootstrap enterprise deploy?`
      : `  Bootstrap enterprise deploy for "${request.customerSlug}" stage "${request.stage}"?`;
    const ok = await confirm(message);
    if (!ok) {
      throw new Error("Enterprise deploy aborted.");
    }
  }

  const runBootstrap = deps.runBootstrap ?? runEnterpriseBootstrap;
  const bootstrap = await runBootstrap({
    targetDir: request.checkoutDir,
    customerSlug: request.customerSlug,
    repository: request.repository,
    stages: [request.stage],
    releaseVersion: options.releaseVersion,
    manifestUrl: options.manifestUrl,
    manifestSha256: options.manifestSha256,
    terraformModuleVersion: options.terraformModuleVersion,
    dispatchWorkflow: true,
  });

  return { kind: "bootstrap", request, bootstrap };
}

async function promptWhenInteractive(
  message: string,
  stdinIsTty: boolean,
  promptInput: EnterpriseDeployDependencies["promptInput"],
  nonInteractiveError: string,
): Promise<string> {
  if (!stdinIsTty) throw new Error(nonInteractiveError);
  if (promptInput) return promptInput(message);
  const { input } = await import("@inquirer/prompts");
  return input({ message });
}
