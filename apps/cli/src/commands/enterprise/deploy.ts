import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { isProdLike, validateStage } from "../../config.js";
import {
  loadEnterpriseDeployment,
  saveEnterpriseDeployment,
  type EnterpriseDeploymentConfig,
} from "../../environments.js";
import { confirm } from "../../prompt.js";
import {
  runEnterpriseBootstrap,
  type EnterpriseBootstrapOptions,
  type EnterpriseBootstrapResult,
} from "./bootstrap.js";
import { resolveEnterpriseReleasePin } from "./release.js";
import {
  commitAndPushEnterpriseRepository,
  GhCliEnterpriseRepositoryClient,
  GitCliEnterpriseGitClient,
  prepareEnterpriseRepository,
  type EnterpriseGitClient,
  type EnterpriseRepositoryClient,
} from "./repository.js";
import {
  GhCliEnterpriseSecretSetter,
  resolveEnterpriseStageSecrets,
  setEnterpriseStageSecrets,
  type EnterpriseSecretName,
  type EnterpriseSecretSetter,
} from "./secrets.js";
import {
  runEnterpriseWorkflow,
  type EnterpriseWorkflowClient,
  type EnterpriseWorkflowDependencies,
  type EnterpriseWorkflowResult,
} from "./workflow.js";
import type { BootstrapStepResult } from "./aws-bootstrap.js";

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
  dbPassword?: string;
  apiAuthSecret?: string;
  dryRun?: boolean;
  runSmokes?: boolean;
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
  runSmokes: boolean;
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
      repository: BootstrapStepResult[];
      secrets: BootstrapStepResult[];
      git: BootstrapStepResult[];
      dispatch: BootstrapStepResult[];
      workflow: EnterpriseWorkflowResult;
    }
  | {
      kind: "dispatch";
      request: EnterpriseDeployRequest;
      workflow: EnterpriseWorkflowResult;
    };

export interface EnterpriseDeployDependencies {
  cwd?: string;
  stdinIsTty?: boolean;
  loadDeployment?: (customerSlug: string) => EnterpriseDeploymentConfig | null;
  runBootstrap?: (
    options: EnterpriseBootstrapOptions,
  ) => Promise<EnterpriseBootstrapResult>;
  promptInput?: (message: string, defaultValue?: string) => Promise<string>;
  promptSelect?: <T extends string>(options: {
    message: string;
    choices: Array<{ name: string; value: T; description?: string }>;
    defaultValue: T;
  }) => Promise<T>;
  promptConfirm?: (message: string) => Promise<boolean>;
  inferRepository?: (repoRoot: string) => string | undefined;
  repositoryClient?: EnterpriseRepositoryClient;
  gitClient?: EnterpriseGitClient;
  secretSetter?: EnterpriseSecretSetter;
  promptSecret?: (stage: string, name: EnterpriseSecretName) => Promise<string>;
  fetchManifest?: (url: string) => Promise<ArrayBuffer>;
  workflowClient?: EnterpriseWorkflowClient;
  discoverUrls?: EnterpriseWorkflowDependencies["discoverUrls"];
  workflowProgress?: EnterpriseWorkflowDependencies["progress"];
  sleep?: EnterpriseWorkflowDependencies["sleep"];
  saveDeployment?: (config: EnterpriseDeploymentConfig) => void;
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

export function inferGitHubRepositoryFromRemote(
  repoRoot: string,
): string | undefined {
  let remote: string;
  try {
    remote = execFileSync(
      "git",
      ["-C", repoRoot, "remote", "get-url", "origin"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return undefined;
  }

  return parseGitHubRepositoryRemote(remote);
}

export function parseGitHubRepositoryRemote(
  remote: string,
): string | undefined {
  const normalized = remote.trim().replace(/\.git$/, "");
  const patterns = [
    /^git@github\.com:([^/]+)\/(.+)$/,
    /^https:\/\/github\.com\/([^/]+)\/(.+)$/,
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match) return `${match[1]}/${match[2]}`;
  }
  return undefined;
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
  const stdinIsTty = deps.stdinIsTty ?? Boolean(process.stdin.isTTY);
  const inferRepository =
    deps.inferRepository ?? inferGitHubRepositoryFromRemote;
  const component = await resolveEnterpriseDeployComponent(
    options,
    stdinIsTty,
    deps,
  );

  const componentCheck = validateEnterpriseDeployComponent(component);
  if (!componentCheck.valid) {
    throw new Error(componentCheck.error);
  }

  const customerSlug =
    options.customer ??
    repoContext?.customerSlug ??
    (await promptWhenInteractive(
      "Customer slug (for example acme):",
      stdinIsTty,
      deps.promptInput,
      "Customer slug is required for enterprise deploy. Pass --customer <slug>.",
    ));
  const registry = loadDeployment(customerSlug);
  const stageDefault =
    registry?.defaultStage ?? repoContext?.stages[0] ?? "dev";
  const stage =
    options.stage ??
    (options.bootstrap
      ? await resolveEnterpriseBootstrapStage(
          registry,
          repoContext,
          stdinIsTty,
          deps,
        )
      : await resolveEnterpriseDispatchStage(stageDefault, stdinIsTty, deps));
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
      "GitHub repository is required for enterprise deploy. Pass --repo <owner/name>.",
      `${customerSlug}/${customerSlug}-thinkwork-deploy`,
    ));
  const checkoutDir =
    options.checkoutDir ??
    registry?.checkoutDir ??
    registry?.targetDir ??
    repoContext?.repoRoot ??
    join(resolve(cwd), `${customerSlug}-thinkwork-deploy`);
  const runSmokes = await resolveEnterpriseRunSmokes(
    options,
    component as EnterpriseDeployComponent,
    stdinIsTty,
    deps,
  );

  return {
    customerSlug,
    repository,
    checkoutDir: resolve(checkoutDir),
    stage,
    component: component as EnterpriseDeployComponent,
    runSmokes,
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
  const stdinIsTty = deps.stdinIsTty ?? Boolean(process.stdin.isTTY);

  if (!request.repository) {
    throw new Error(
      "GitHub repository is required for enterprise deploy bootstrap. Pass --repo <owner/name>.",
    );
  }

  if (!request.bootstrap) {
    const workflow = await dispatchEnterpriseWorkflow(request, options, deps);
    persistWorkflowMetadata(request, workflow, undefined, deps.saveDeployment);
    return { kind: "dispatch", request, workflow };
  }

  if (!options.yes && !options.dryRun) {
    const message = isProdLike(request.stage)
      ? `  Stage "${request.stage}" is production-like. Bootstrap enterprise deploy?`
      : `  Bootstrap enterprise deploy for "${request.customerSlug}" stage "${request.stage}"?`;
    const ok = await confirm(message);
    if (!ok) {
      throw new Error("Enterprise deploy aborted.");
    }
  }

  const runBootstrap = deps.runBootstrap ?? runEnterpriseBootstrap;
  const bootstrapStages = enterpriseBootstrapStages(request.stage);
  const manifestSha256 = await resolveReleaseManifestSha256({
    releaseVersion: options.releaseVersion,
    manifestUrl: options.manifestUrl,
    manifestSha256: options.manifestSha256,
    terraformModuleVersion: options.terraformModuleVersion,
    dryRun: options.dryRun,
    fetchManifest: deps.fetchManifest,
  });
  const stageSecrets = await resolveEnterpriseStageSecrets({
    stages: bootstrapStages,
    dbPassword: options.dbPassword,
    apiAuthSecret: options.apiAuthSecret,
    stdinIsTty: deps.stdinIsTty,
    promptSecret: deps.promptSecret,
    dryRun: options.dryRun,
  });
  const repositoryClient =
    deps.repositoryClient ?? new GhCliEnterpriseRepositoryClient();
  const gitClient = deps.gitClient ?? new GitCliEnterpriseGitClient();
  const repositorySteps = await prepareEnterpriseRepository(
    {
      repository: request.repository,
      targetDir: request.checkoutDir,
      createRepo: request.createRepo,
      dryRun: options.dryRun,
      promptCreateRepo:
        !options.yes && !options.dryRun && stdinIsTty
          ? async (repository) =>
              (deps.promptConfirm ?? confirm)(
                `  GitHub repository ${repository} does not exist. Create it as a private repository?`,
              )
          : undefined,
    },
    repositoryClient,
    gitClient,
  );
  const bootstrap = await runBootstrap({
    targetDir: request.checkoutDir,
    customerSlug: request.customerSlug,
    repository: request.repository,
    stages: bootstrapStages,
    releaseVersion: options.releaseVersion,
    manifestUrl: options.manifestUrl,
    manifestSha256,
    terraformModuleVersion: options.terraformModuleVersion,
    dispatchWorkflow: false,
    dryRun: options.dryRun,
  });
  const secrets = options.dryRun
    ? Object.keys(stageSecrets).map((stage) => ({
        target: `${request.repository}:${stage}:secrets`,
        status: "planned" as const,
        message: `Would set ${Object.keys(stageSecrets[stage]).length} GitHub Environment secret(s) for ${stage}.`,
      }))
    : await setEnterpriseStageSecrets(
        request.repository,
        stageSecrets,
        deps.secretSetter ?? new GhCliEnterpriseSecretSetter(),
      );
  const git = options.dryRun
    ? [
        {
          target: request.checkoutDir,
          status: "planned" as const,
          message: "Would commit and push deployment repository changes.",
        },
      ]
    : await commitAndPushEnterpriseRepository(request.checkoutDir, gitClient);
  const workflow = options.dryRun
    ? plannedEnterpriseWorkflow(request)
    : await dispatchEnterpriseWorkflow(request, options, deps, bootstrap);
  const dispatch = [workflow.dispatch];
  if (!options.dryRun) {
    persistWorkflowMetadata(request, workflow, bootstrap, deps.saveDeployment);
  }

  return {
    kind: "bootstrap",
    request,
    bootstrap,
    repository: repositorySteps.steps,
    secrets,
    git,
    dispatch,
    workflow,
  };
}

async function resolveEnterpriseBootstrapStage(
  registry: EnterpriseDeploymentConfig | null,
  repoContext: EnterpriseDeploymentRepoContext | null,
  stdinIsTty: boolean,
  deps: EnterpriseDeployDependencies,
): Promise<string> {
  return (
    registry?.defaultStage ??
    repoContext?.stages[0] ??
    (await promptWhenInteractive(
      "Deployment stage:",
      stdinIsTty,
      deps.promptInput,
      "Deployment stage is required for enterprise bootstrap. Pass --stage <name>.",
      "dev",
    ))
  );
}

async function resolveEnterpriseDispatchStage(
  defaultValue: string,
  stdinIsTty: boolean,
  deps: EnterpriseDeployDependencies,
): Promise<string> {
  if (!stdinIsTty) return defaultValue;
  return promptWhenInteractive(
    "Deployment stage:",
    stdinIsTty,
    deps.promptInput,
    "Deployment stage is required for enterprise deploy. Pass --stage <name>.",
    defaultValue,
  );
}

async function resolveEnterpriseDeployComponent(
  options: EnterpriseDeployOptions,
  stdinIsTty: boolean,
  deps: EnterpriseDeployDependencies,
): Promise<string> {
  const defaultValue = options.component ?? "all";
  if (options.bootstrap || !stdinIsTty) return defaultValue;
  if (
    !ENTERPRISE_DEPLOY_COMPONENTS.includes(
      defaultValue as EnterpriseDeployComponent,
    )
  ) {
    return defaultValue;
  }

  return promptSelectWhenInteractive(
    {
      message: "Deployment component:",
      choices: [
        {
          name: "all",
          value: "all",
          description:
            "Deploy release artifacts, Terraform, runtimes, overlays, and smokes",
        },
        {
          name: "foundation",
          value: "foundation",
          description: "Terraform apply only",
        },
        {
          name: "artifacts",
          value: "artifacts",
          description: "Release artifacts, runtime images, and static bundles",
        },
        {
          name: "overlays",
          value: "overlays",
          description: "Customer overlays only",
        },
        {
          name: "smokes",
          value: "smokes",
          description: "Smoke checks against an existing stage",
        },
      ],
      defaultValue: defaultValue as EnterpriseDeployComponent,
    },
    deps.promptSelect,
  );
}

async function resolveEnterpriseRunSmokes(
  options: EnterpriseDeployOptions,
  component: EnterpriseDeployComponent,
  stdinIsTty: boolean,
  deps: EnterpriseDeployDependencies,
): Promise<boolean> {
  if (options.runSmokes !== undefined) return options.runSmokes;
  if (options.bootstrap || !stdinIsTty) return true;
  if (component !== "all" && component !== "smokes") return true;

  return promptConfirmWhenInteractive(
    "Run smoke checks after deploy?",
    true,
    deps.promptConfirm,
  );
}

async function promptWhenInteractive(
  message: string,
  stdinIsTty: boolean,
  promptInput: EnterpriseDeployDependencies["promptInput"],
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

async function promptSelectWhenInteractive<T extends string>(
  options: {
    message: string;
    choices: Array<{ name: string; value: T; description?: string }>;
    defaultValue: T;
  },
  promptSelect: EnterpriseDeployDependencies["promptSelect"],
): Promise<T> {
  if (promptSelect) return promptSelect(options);
  const { select } = await import("@inquirer/prompts");
  return select({
    message: options.message,
    choices: options.choices,
    default: options.defaultValue,
  });
}

async function promptConfirmWhenInteractive(
  message: string,
  defaultValue: boolean,
  promptConfirm: EnterpriseDeployDependencies["promptConfirm"],
): Promise<boolean> {
  if (promptConfirm) return promptConfirm(message);
  const { confirm: confirmPrompt } = await import("@inquirer/prompts");
  return confirmPrompt({ message, default: defaultValue });
}

function enterpriseBootstrapStages(requestedStage: string): string[] {
  return [...new Set([requestedStage, "prod"])];
}

async function resolveReleaseManifestSha256(options: {
  releaseVersion?: string;
  manifestUrl?: string;
  manifestSha256?: string;
  terraformModuleVersion?: string;
  dryRun?: boolean;
  fetchManifest?: (url: string) => Promise<ArrayBuffer>;
}): Promise<string | undefined> {
  if (options.manifestSha256) return options.manifestSha256;
  if (options.dryRun) return undefined;
  const release = resolveEnterpriseReleasePin({
    releaseVersion: options.releaseVersion,
    manifestUrl: options.manifestUrl,
    terraformModuleVersion: options.terraformModuleVersion,
  });

  const fetchManifest =
    options.fetchManifest ??
    (async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Release manifest fetch failed (${response.status}) for ${url}.`,
        );
      }
      return response.arrayBuffer();
    });
  const body = await fetchManifest(release.manifestUrl);
  return createHash("sha256").update(Buffer.from(body)).digest("hex");
}

async function dispatchEnterpriseWorkflow(
  request: EnterpriseDeployRequest,
  options: EnterpriseDeployOptions,
  deps: EnterpriseDeployDependencies,
  bootstrap?: EnterpriseBootstrapResult,
): Promise<EnterpriseWorkflowResult> {
  if (!request.repository) {
    throw new Error(
      "GitHub repository is required for enterprise deploy. Pass --repo <owner/name>.",
    );
  }
  return runEnterpriseWorkflow(
    {
      repository: request.repository,
      stage: request.stage,
      component: request.component,
      runSmokes: request.runSmokes,
      wait: request.wait,
      region: bootstrap?.plan.region ?? request.registry?.region,
    },
    {
      client: deps.workflowClient,
      discoverUrls: deps.discoverUrls,
      progress:
        deps.workflowProgress ??
        (request.wait && process.stdout.isTTY
          ? (message) => console.log(`  ${message}`)
          : undefined),
      sleep: deps.sleep,
    },
  );
}

function plannedEnterpriseWorkflow(
  request: EnterpriseDeployRequest,
): EnterpriseWorkflowResult {
  const repository = request.repository ?? "<repo>";
  return {
    dispatch: {
      target: `${repository}:deploy.yml:${request.stage}`,
      status: "planned",
      message: `Would dispatch deploy workflow for ${request.stage}.`,
    },
    artifacts: [],
    urls: {},
    waited: false,
  };
}

function persistWorkflowMetadata(
  request: EnterpriseDeployRequest,
  workflow: EnterpriseWorkflowResult,
  bootstrap: EnterpriseBootstrapResult | undefined,
  saveDeployment = saveEnterpriseDeployment,
): void {
  if (!workflow.run) return;
  const timestamp = new Date().toISOString();

  if (bootstrap) {
    const plan = bootstrap.plan;
    saveDeployment({
      customerSlug: plan.customerSlug,
      repository: plan.repository,
      targetDir: plan.targetDir,
      checkoutDir: plan.targetDir,
      defaultStage: request.stage,
      lastWorkflowRunId: workflow.run.id,
      lastWorkflowUrl: workflow.run.url,
      accountId: plan.accountId,
      region: plan.region,
      stages: plan.stages,
      artifactBucket: plan.aws.artifactBucket,
      stateBucket: plan.aws.stateBucket,
      lockTable: plan.aws.lockTable,
      releaseVersion: plan.release.version,
      releaseManifestUrl: plan.release.manifestUrl,
      updatedAt: timestamp,
    });
    return;
  }

  if (!request.registry) return;
  saveDeployment({
    ...request.registry,
    defaultStage: request.stage,
    lastWorkflowRunId: workflow.run.id,
    lastWorkflowUrl: workflow.run.url,
    updatedAt: timestamp,
  });
}
