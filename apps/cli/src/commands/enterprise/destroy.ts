import { isProdLike, validateStage } from "../../config.js";
import {
  loadEnterpriseDeployment,
  saveEnterpriseDeployment,
  type EnterpriseDeploymentConfig,
} from "../../environments.js";
import { confirm } from "../../prompt.js";
import {
  findEnterpriseDeploymentRepo,
  inferGitHubRepositoryFromRemote,
  type EnterpriseDeploymentRepoContext,
} from "./deploy.js";
import {
  runEnterpriseWorkflow,
  type EnterpriseWorkflowClient,
  type EnterpriseWorkflowDependencies,
  type EnterpriseWorkflowResult,
} from "./workflow.js";

export interface EnterpriseDestroyOptions {
  customer?: string;
  repo?: string;
  stage?: string;
  wait?: boolean;
  yes?: boolean;
  localTerraform?: boolean;
}

export interface EnterpriseDestroyRequest {
  customerSlug: string;
  repository: string;
  stage: string;
  wait: boolean;
  registry?: EnterpriseDeploymentConfig;
  repoContext?: EnterpriseDeploymentRepoContext;
}

export interface EnterpriseDestroyResult {
  request: EnterpriseDestroyRequest;
  workflow: EnterpriseWorkflowResult;
}

export interface EnterpriseDestroyDependencies {
  cwd?: string;
  stdinIsTty?: boolean;
  loadDeployment?: (customerSlug: string) => EnterpriseDeploymentConfig | null;
  saveDeployment?: (config: EnterpriseDeploymentConfig) => void;
  promptInput?: (message: string, defaultValue?: string) => Promise<string>;
  promptConfirm?: (message: string) => Promise<boolean>;
  inferRepository?: (repoRoot: string) => string | undefined;
  workflowClient?: EnterpriseWorkflowClient;
  workflowProgress?: EnterpriseWorkflowDependencies["progress"];
  sleep?: EnterpriseWorkflowDependencies["sleep"];
}

export function shouldUseEnterpriseDestroy(
  options: EnterpriseDestroyOptions,
  deps: Pick<EnterpriseDestroyDependencies, "cwd"> = {},
): boolean {
  if (options.localTerraform) return false;
  if (options.customer || options.repo) return true;
  return findEnterpriseDeploymentRepo(deps.cwd) !== null;
}

export async function resolveEnterpriseDestroyRequest(
  options: EnterpriseDestroyOptions,
  deps: EnterpriseDestroyDependencies = {},
): Promise<EnterpriseDestroyRequest> {
  const cwd = deps.cwd ?? process.cwd();
  const repoContext = findEnterpriseDeploymentRepo(cwd);
  const stdinIsTty = deps.stdinIsTty ?? Boolean(process.stdin.isTTY);
  const loadDeployment = deps.loadDeployment ?? loadEnterpriseDeployment;
  const inferRepository =
    deps.inferRepository ?? inferGitHubRepositoryFromRemote;

  const customerSlug =
    options.customer ??
    repoContext?.customerSlug ??
    (await promptWhenInteractive(
      "Customer slug (for example acme):",
      stdinIsTty,
      deps.promptInput,
      "Customer slug is required for enterprise destroy. Pass --customer <slug>.",
    ));
  const registry = loadDeployment(customerSlug);
  const stageDefault =
    registry?.defaultStage ?? repoContext?.stages[0] ?? "dev";
  const stage =
    options.stage ??
    (await promptWhenInteractive(
      "Stage to destroy:",
      stdinIsTty,
      deps.promptInput,
      "Stage is required for enterprise destroy. Pass --stage <name>.",
      stageDefault,
    ));
  const stageCheck = validateStage(stage);
  if (!stageCheck.valid) {
    throw new Error(stageCheck.error);
  }

  const repository =
    options.repo ??
    registry?.repository ??
    (repoContext ? inferRepository(repoContext.repoRoot) : undefined) ??
    (await promptWhenInteractive(
      "GitHub deployment repo (owner/name):",
      stdinIsTty,
      deps.promptInput,
      "GitHub repository is required for enterprise destroy. Pass --repo <owner/name>.",
      `${customerSlug}/${customerSlug}-thinkwork-deploy`,
    ));

  return {
    customerSlug,
    repository,
    stage,
    wait: options.wait !== false,
    registry: registry ?? undefined,
    repoContext: repoContext ?? undefined,
  };
}

export async function runEnterpriseDestroy(
  options: EnterpriseDestroyOptions,
  deps: EnterpriseDestroyDependencies = {},
): Promise<EnterpriseDestroyResult> {
  const request = await resolveEnterpriseDestroyRequest(options, deps);
  const stdinIsTty = deps.stdinIsTty ?? Boolean(process.stdin.isTTY);

  if (!options.yes) {
    if (!stdinIsTty) {
      throw new Error(
        "Refusing to destroy an enterprise stage without --yes in a non-interactive session.",
      );
    }
    const impact =
      `  This will dispatch operation=destroy to ${request.repository} and ` +
      `permanently remove the "${request.stage}" stage stack for "${request.customerSlug}". ` +
      "Customer-wide bootstrap resources such as the deployment repository, Terraform state bucket, artifact bucket, and OIDC trust are preserved.";
    const message = isProdLike(request.stage)
      ? `  Stage "${request.stage}" is production-like.\n${impact}\n  Continue?`
      : `${impact}\n  Continue?`;
    const ok = await (deps.promptConfirm ?? confirm)(message);
    if (!ok) {
      throw new Error("Enterprise destroy aborted.");
    }
  }

  const workflow = await runEnterpriseWorkflow(
    {
      operation: "destroy",
      repository: request.repository,
      stage: request.stage,
      component: "all",
      runSmokes: false,
      wait: request.wait,
      region: request.registry?.region,
    },
    {
      client: deps.workflowClient,
      progress:
        deps.workflowProgress ??
        (request.wait && process.stdout.isTTY
          ? (message) => console.log(`  ${message}`)
          : undefined),
      sleep: deps.sleep,
    },
  );

  persistDestroyWorkflowMetadata(request, workflow, deps.saveDeployment);
  return { request, workflow };
}

function persistDestroyWorkflowMetadata(
  request: EnterpriseDestroyRequest,
  workflow: EnterpriseWorkflowResult,
  saveDeployment = saveEnterpriseDeployment,
): void {
  if (!workflow.run || !request.registry) return;
  saveDeployment({
    ...request.registry,
    defaultStage: request.stage,
    lastWorkflowRunId: workflow.run.id,
    lastWorkflowUrl: workflow.run.url,
    updatedAt: new Date().toISOString(),
  });
}

async function promptWhenInteractive(
  message: string,
  stdinIsTty: boolean,
  promptInput: EnterpriseDestroyDependencies["promptInput"],
  nonInteractiveError: string,
  defaultValue?: string,
): Promise<string> {
  if (!stdinIsTty) throw new Error(nonInteractiveError);
  if (promptInput) {
    const value = await promptInput(message, defaultValue);
    return value.trim() || defaultValue || value;
  }
  const { input } = await import("@inquirer/prompts");
  const value = await input({ message, default: defaultValue });
  return value.trim() || defaultValue || value;
}
