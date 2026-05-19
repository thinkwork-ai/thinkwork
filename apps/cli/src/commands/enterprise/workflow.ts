import { execFileSync } from "node:child_process";

import {
  discoverThinkworkStageUrls,
  type DiscoveredThinkworkStageUrls,
} from "../../aws-discovery.js";
import { type EnterpriseDeployComponent } from "./deploy.js";
import { parseGitHubRepository } from "./github.js";
import type { BootstrapStepResult } from "./aws-bootstrap.js";

export interface EnterpriseWorkflowDispatchOptions {
  repository: string;
  stage: string;
  component: EnterpriseDeployComponent;
  runSmokes?: boolean;
  operation?: "deploy" | "destroy";
}

export interface EnterpriseWorkflowRun {
  id: string;
  url: string;
  status: string;
  conclusion?: string | null;
  failedJobs: string[];
}

export interface EnterpriseWorkflowResult {
  dispatch: BootstrapStepResult;
  run?: EnterpriseWorkflowRun;
  artifacts: string[];
  urls: DiscoveredThinkworkStageUrls;
  discoveryWarning?: string;
  waited: boolean;
}

export interface EnterpriseWorkflowClient {
  dispatchDeployWorkflow(
    options: EnterpriseWorkflowDispatchOptions,
  ): Promise<BootstrapStepResult>;
  latestDeployRun(
    options: EnterpriseWorkflowDispatchOptions & { since: Date },
  ): Promise<EnterpriseWorkflowRun | null>;
  getRun(repository: string, runId: string): Promise<EnterpriseWorkflowRun>;
  listRunArtifacts(repository: string, runId: string): Promise<string[]>;
}

export interface EnterpriseWorkflowDependencies {
  client?: EnterpriseWorkflowClient;
  discoverUrls?: (
    stage: string,
    region: string,
  ) => DiscoveredThinkworkStageUrls;
  progress?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface RunEnterpriseWorkflowOptions
  extends EnterpriseWorkflowDispatchOptions {
  wait: boolean;
  region?: string;
  runLookupAttempts?: number;
  runLookupDelayMs?: number;
  pollIntervalMs?: number;
}

export class WorkflowRunFailedError extends Error {
  constructor(readonly run: EnterpriseWorkflowRun) {
    const failedJobs =
      run.failedJobs.length > 0 ? run.failedJobs.join(", ") : "unknown job";
    super(
      `Enterprise workflow failed (${run.conclusion ?? "unknown"}): ${failedJobs}. Inspect logs with: gh run view ${run.id} --log`,
    );
  }
}

export class GhCliEnterpriseWorkflowClient implements EnterpriseWorkflowClient {
  async dispatchDeployWorkflow(
    options: EnterpriseWorkflowDispatchOptions,
  ): Promise<BootstrapStepResult> {
    const repository = parseGitHubRepository(options.repository).fullName;
    const fields = [
      ...(options.operation === "destroy"
        ? ["--field", "operation=destroy"]
        : []),
      "--field",
      `stage=${options.stage}`,
      "--field",
      `component=${options.component}`,
      "--field",
      `run_smokes=${String(options.runSmokes ?? true)}`,
    ];
    gh(["workflow", "run", "deploy.yml", "--repo", repository, ...fields]);
    return {
      target: `${repository}:deploy.yml:${options.stage}`,
      status: "created",
      message: `Dispatched ${options.operation ?? "deploy"} workflow for ${options.stage}.`,
    };
  }

  async latestDeployRun(
    options: EnterpriseWorkflowDispatchOptions & { since: Date },
  ): Promise<EnterpriseWorkflowRun | null> {
    const repository = parseGitHubRepository(options.repository).fullName;
    const runs = ghJson<GitHubRunListItem[]>([
      "run",
      "list",
      "--repo",
      repository,
      "--workflow",
      "deploy.yml",
      "--event",
      "workflow_dispatch",
      "--limit",
      "10",
      "--json",
      "databaseId,url,status,conclusion,createdAt",
    ]);
    const sinceTime = options.since.getTime() - 5_000;
    const run = runs
      .filter((item) => Date.parse(item.createdAt) >= sinceTime)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    return run ? toWorkflowRun(run, []) : null;
  }

  async getRun(
    repository: string,
    runId: string,
  ): Promise<EnterpriseWorkflowRun> {
    const run = ghJson<GitHubRunView>([
      "run",
      "view",
      runId,
      "--repo",
      parseGitHubRepository(repository).fullName,
      "--json",
      "databaseId,url,status,conclusion,jobs",
    ]);
    const failedJobs = (run.jobs ?? [])
      .filter((job) => job.conclusion && job.conclusion !== "success")
      .map((job) => job.name);
    return toWorkflowRun(run, failedJobs);
  }

  async listRunArtifacts(repository: string, runId: string): Promise<string[]> {
    const fullName = parseGitHubRepository(repository).fullName;
    const output = gh([
      "api",
      `repos/${fullName}/actions/runs/${runId}/artifacts`,
      "--jq",
      ".artifacts[].name",
    ]);
    return output
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean);
  }
}

export async function runEnterpriseWorkflow(
  options: RunEnterpriseWorkflowOptions,
  deps: EnterpriseWorkflowDependencies = {},
): Promise<EnterpriseWorkflowResult> {
  const client = deps.client ?? new GhCliEnterpriseWorkflowClient();
  const sleep =
    deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => new Date());
  const progress = deps.progress ?? (() => undefined);
  const dispatchStartedAt = now();
  const dispatch = await client.dispatchDeployWorkflow(options);
  const run = await resolveDispatchedRun(
    options,
    client,
    sleep,
    progress,
    dispatchStartedAt,
  );

  if (!options.wait) {
    if (!run) {
      throw new Error(
        `Dispatched ${options.operation ?? "deploy"} workflow for ${options.stage}, but no GitHub Actions run was found. Inspect ${options.repository} Actions manually.`,
      );
    }
    return {
      dispatch,
      run,
      artifacts: [],
      urls: {},
      waited: false,
    };
  }
  if (!run) {
    throw new Error(
      `Dispatched ${options.operation ?? "deploy"} workflow for ${options.stage}, but no GitHub Actions run was found. Inspect ${options.repository} Actions manually.`,
    );
  }

  const completedRun = await waitForWorkflowRun(
    options,
    client,
    sleep,
    progress,
    run.id,
  );
  if (completedRun.conclusion !== "success") {
    throw new WorkflowRunFailedError(completedRun);
  }

  let artifacts: string[] = [];
  try {
    artifacts = await client.listRunArtifacts(
      options.repository,
      completedRun.id,
    );
  } catch {
    artifacts = [
      `thinkwork-${options.operation ?? "deploy"}-${options.stage}-${completedRun.id}`,
    ];
  }

  const discovery =
    options.operation === "destroy"
      ? { urls: {}, warning: undefined }
      : discoverStageUrls(options, deps);
  return {
    dispatch,
    run: completedRun,
    artifacts,
    urls: discovery.urls,
    discoveryWarning: discovery.warning,
    waited: true,
  };
}

async function resolveDispatchedRun(
  options: RunEnterpriseWorkflowOptions,
  client: EnterpriseWorkflowClient,
  sleep: (ms: number) => Promise<void>,
  progress: (message: string) => void,
  dispatchStartedAt: Date,
): Promise<EnterpriseWorkflowRun | null> {
  const attempts = options.runLookupAttempts ?? 10;
  const delayMs = options.runLookupDelayMs ?? 2_000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const run = await client.latestDeployRun({
      ...options,
      since: dispatchStartedAt,
    });
    if (run) {
      progress(`GitHub Actions run ${run.id} started: ${run.url}`);
      return run;
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  return null;
}

async function waitForWorkflowRun(
  options: RunEnterpriseWorkflowOptions,
  client: EnterpriseWorkflowClient,
  sleep: (ms: number) => Promise<void>,
  progress: (message: string) => void,
  runId: string,
): Promise<EnterpriseWorkflowRun> {
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  let lastStatus = "";
  while (true) {
    const run = await client.getRun(options.repository, runId);
    const status = `${run.status}${run.conclusion ? `/${run.conclusion}` : ""}`;
    if (status !== lastStatus) {
      progress(`GitHub Actions run ${run.id}: ${status}`);
      lastStatus = status;
    }
    if (run.status === "completed") return run;
    await sleep(pollIntervalMs);
  }
}

function discoverStageUrls(
  options: RunEnterpriseWorkflowOptions,
  deps: EnterpriseWorkflowDependencies,
): { urls: DiscoveredThinkworkStageUrls; warning?: string } {
  if (!options.region) return { urls: {} };
  try {
    const discoverUrls = deps.discoverUrls ?? discoverThinkworkStageUrls;
    return { urls: discoverUrls(options.stage, options.region) };
  } catch (err) {
    return {
      urls: {},
      warning: `Deploy succeeded, but URL discovery failed: ${(err as Error).message}`,
    };
  }
}

interface GitHubRunListItem {
  databaseId: number;
  url: string;
  status: string;
  conclusion?: string | null;
  createdAt: string;
}

interface GitHubRunView extends Omit<GitHubRunListItem, "createdAt"> {
  jobs?: Array<{ name: string; conclusion?: string | null }>;
}

function toWorkflowRun(
  run: GitHubRunListItem | GitHubRunView,
  failedJobs: string[],
): EnterpriseWorkflowRun {
  return {
    id: String(run.databaseId),
    url: run.url,
    status: run.status,
    conclusion: run.conclusion,
    failedJobs,
  };
}

function ghJson<T>(args: string[]): T {
  return JSON.parse(gh(args)) as T;
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" });
}
