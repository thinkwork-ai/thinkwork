import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runDeployCommand,
  runLocalTerraformDeploy,
  type DeployCommandOptions,
} from "../src/commands/deploy.js";
import {
  findEnterpriseDeploymentRepo,
  inferGitHubRepositoryFromRemote,
  parseGitHubRepositoryRemote,
  resolveEnterpriseDeployRequest,
  runEnterpriseDeploy,
  shouldUseEnterpriseDeploy,
  validateEnterpriseDeployComponent,
} from "../src/commands/enterprise/deploy.js";
import { validateComponent } from "../src/config.js";
import type { EnterpriseBootstrapResult } from "../src/commands/enterprise/bootstrap.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "thinkwork-enterprise-deploy-"));
  tempDirs.push(dir);
  return dir;
}

function writeDeploymentRepo(root: string): void {
  mkdirSync(join(root, "customer"), { recursive: true });
  writeFileSync(
    join(root, "thinkwork.lock"),
    JSON.stringify({ version: "v1.2.3" }, null, 2),
  );
  writeFileSync(
    join(root, "customer", "deployment.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        customerSlug: "acme",
        stages: {
          dev: {
            tenantSlug: "acme-dev",
            evalPacks: [],
            seedPacks: [],
            skillPacks: [],
            workspaceDefaultPacks: [],
            branding: null,
            defaultAgentTemplateSlug: "default",
          },
        },
      },
      null,
      2,
    ),
  );
}

function bootstrapResult(): EnterpriseBootstrapResult {
  return {
    plan: {
      customerSlug: "acme",
      targetDir: "/tmp/deploy",
      repository: "acme/deploy",
      stages: ["dev", "prod"],
      accountId: "123456789012",
      region: "us-east-1",
      release: {
        version: "v1.2.3",
        manifestUrl: "https://example.test/manifest.json",
        manifestSha256: "abc123",
        terraformModuleVersion: "1.2.3",
      },
      aws: {
        artifactBucket: "acme-thinkwork-release-artifacts",
        stateBucket: "acme-thinkwork-terraform-state",
        lockTable: "acme-thinkwork-terraform-locks",
        oidcProviderArn:
          "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com",
        stageRoles: [],
      },
      github: {} as EnterpriseBootstrapResult["plan"]["github"],
    },
    template: { written: [], preserved: [] },
    aws: [],
    github: [],
    metadata: {
      target: "acme",
      status: "updated",
      message: "Recorded local enterprise deployment metadata without secrets.",
    },
  };
}

describe("top-level enterprise deploy routing", () => {
  it("routes bootstrap deploys to enterprise orchestration without calling local Terraform", async () => {
    const localDeploy = vi.fn();
    const enterpriseDeploy = vi.fn(async () => ({
      kind: "bootstrap" as const,
      request: {
        customerSlug: "acme",
        repository: "acme/deploy",
        checkoutDir: tempDir(),
        stage: "dev",
        component: "all" as const,
        bootstrap: true,
        wait: true,
        createRepo: false,
      },
      bootstrap: bootstrapResult(),
      repository: [],
      secrets: [],
      git: [],
      dispatch: [],
      workflow: {
        dispatch: {
          target: "acme/deploy:deploy.yml:dev",
          status: "created" as const,
          message: "dispatched",
        },
        artifacts: [],
        urls: {},
        waited: false,
      },
    }));

    await runDeployCommand(
      {
        bootstrap: true,
        customer: "acme",
        repo: "acme/deploy",
        stage: "dev",
        component: "all",
        yes: true,
      },
      { localDeploy, enterpriseDeploy },
    );

    expect(enterpriseDeploy).toHaveBeenCalledOnce();
    expect(localDeploy).not.toHaveBeenCalled();
  });

  it("preserves the local Terraform path outside enterprise context", async () => {
    const localDeploy = vi.fn();
    const enterpriseDeploy = vi.fn();

    await runDeployCommand(
      { stage: "dev", component: "all", yes: true },
      { localDeploy, enterpriseDeploy },
    );

    expect(localDeploy).toHaveBeenCalledOnce();
    expect(enterpriseDeploy).not.toHaveBeenCalled();
  });

  it("detects a generated deployment repo from thinkwork.lock and customer/deployment.json", async () => {
    const root = tempDir();
    writeDeploymentRepo(root);
    const nested = join(root, "customer", "skills");
    mkdirSync(nested, { recursive: true });

    const context = findEnterpriseDeploymentRepo(nested);

    expect(context).toEqual({
      repoRoot: root,
      customerSlug: "acme",
      stages: ["dev"],
    });
    expect(
      shouldUseEnterpriseDeploy({ component: "all" }, { cwd: nested }),
    ).toBe(true);
  });

  it("lets --local-terraform override generated deployment repo detection", () => {
    const root = tempDir();
    writeDeploymentRepo(root);

    expect(
      shouldUseEnterpriseDeploy(
        { localTerraform: true, component: "all" },
        { cwd: root },
      ),
    ).toBe(false);
  });

  it("fails non-interactive bootstrap without a customer slug", async () => {
    await expect(
      resolveEnterpriseDeployRequest(
        { bootstrap: true, repo: "acme/deploy", component: "all" },
        { stdinIsTty: false, cwd: tempDir() },
      ),
    ).rejects.toThrow(/Pass --customer <slug>/);
  });

  it("prompts for bootstrap values so thinkwork deploy --bootstrap can start bare in a TTY", async () => {
    const answers = new Map([
      ["Customer slug (for example acme):", "acme"],
      ["Deployment stage:", ""],
      ["GitHub deployment repo (owner/name):", ""],
    ]);

    const request = await resolveEnterpriseDeployRequest(
      { bootstrap: true, component: "all" },
      {
        stdinIsTty: true,
        cwd: tempDir(),
        loadDeployment: vi.fn(() => null),
        promptInput: vi.fn(async (message, defaultValue) => {
          return answers.get(message) ?? defaultValue ?? "";
        }),
      },
    );

    expect(request).toEqual(
      expect.objectContaining({
        customerSlug: "acme",
        repository: "acme/acme-thinkwork-deploy",
        stage: "dev",
        bootstrap: true,
      }),
    );
  });

  it("validates component names against the selected deploy mode", async () => {
    await expect(
      resolveEnterpriseDeployRequest(
        {
          bootstrap: true,
          customer: "acme",
          repo: "acme/deploy",
          component: "data",
        },
        { stdinIsTty: false, cwd: tempDir() },
      ),
    ).rejects.toThrow(/Invalid enterprise deploy component "data"/);

    expect(validateEnterpriseDeployComponent("smokes").valid).toBe(true);
    expect(validateComponent("smokes").valid).toBe(false);
  });

  it("passes bootstrap routing options to the existing enterprise bootstrap primitive", async () => {
    const root = tempDir();
    const runBootstrap = vi.fn(async () => bootstrapResult());

    const result = await runEnterpriseDeploy(
      {
        bootstrap: true,
        customer: "acme",
        repo: "acme/deploy",
        checkoutDir: root,
        stage: "dev",
        component: "all",
        releaseVersion: "v1.2.3",
        manifestUrl: "https://example.test/manifest.json",
        manifestSha256: "abc123",
        dbPassword: "dev-db",
        apiAuthSecret: "dev-api",
        wait: false,
        yes: true,
      },
      {
        stdinIsTty: false,
        cwd: root,
        runBootstrap,
        repositoryClient: {
          repositoryExists: vi.fn(async () => true),
          createPrivateRepository: vi.fn(),
          cloneRepository: vi.fn(async () => ({
            target: root,
            status: "created",
            message: "cloned",
          })),
        },
        gitClient: {
          isGitRepository: () => true,
          hasChanges: vi.fn(async () => true),
          commitAll: vi.fn(async () => ({
            target: root,
            status: "created",
            message: "committed",
          })),
          push: vi.fn(async () => ({
            target: root,
            status: "updated",
            message: "pushed",
          })),
        },
        secretSetter: {
          setEnvironmentSecret: vi.fn(async () => undefined),
        },
        workflowClient: {
          dispatchDeployWorkflow: vi.fn(async () => ({
            target: "acme/deploy:deploy.yml:dev",
            status: "created",
            message: "dispatched",
          })),
          latestDeployRun: vi.fn(async () => ({
            id: "123",
            url: "https://github.com/acme/deploy/actions/runs/123",
            status: "queued",
            failedJobs: [],
          })),
          getRun: vi.fn(),
          listRunArtifacts: vi.fn(),
        },
      },
    );

    expect(result.kind).toBe("bootstrap");
    expect(runBootstrap).toHaveBeenCalledWith({
      targetDir: root,
      customerSlug: "acme",
      repository: "acme/deploy",
      stages: ["dev", "prod"],
      releaseVersion: "v1.2.3",
      manifestUrl: "https://example.test/manifest.json",
      manifestSha256: "abc123",
      terraformModuleVersion: undefined,
      dispatchWorkflow: false,
      dryRun: undefined,
    });
  });

  it("dispatches follow-up enterprise deploys from saved registry metadata", async () => {
    const saveDeployment = vi.fn();
    const dispatchDeployWorkflow = vi.fn(async () => ({
      target: "acme/deploy:deploy.yml:prod",
      status: "created" as const,
      message: "dispatched",
    }));

    const result = await runEnterpriseDeploy(
      {
        customer: "acme",
        stage: "prod",
        component: "smokes",
        runSmokes: true,
        wait: false,
      },
      {
        stdinIsTty: false,
        loadDeployment: vi.fn(() => ({
          customerSlug: "acme",
          repository: "acme/deploy",
          targetDir: "/tmp/deploy",
          checkoutDir: "/tmp/deploy",
          defaultStage: "dev",
          accountId: "123456789012",
          region: "us-east-1",
          stages: ["dev", "prod"],
          artifactBucket: "acme-thinkwork-release-artifacts",
          stateBucket: "acme-thinkwork-terraform-state",
          lockTable: "acme-thinkwork-terraform-locks",
          releaseVersion: "v1.2.3",
          releaseManifestUrl: "https://example.test/manifest.json",
          updatedAt: "2026-05-19T00:00:00.000Z",
        })),
        workflowClient: {
          dispatchDeployWorkflow,
          latestDeployRun: vi.fn(async () => ({
            id: "456",
            url: "https://github.com/acme/deploy/actions/runs/456",
            status: "queued",
            failedJobs: [],
          })),
          getRun: vi.fn(),
          listRunArtifacts: vi.fn(),
        },
        saveDeployment,
      },
    );

    expect(result.kind).toBe("dispatch");
    expect(dispatchDeployWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: "acme/deploy",
        stage: "prod",
        component: "smokes",
        runSmokes: true,
      }),
    );
    expect(saveDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        customerSlug: "acme",
        defaultStage: "prod",
        lastWorkflowRunId: "456",
        lastWorkflowUrl: "https://github.com/acme/deploy/actions/runs/456",
      }),
    );
  });

  it("dispatches normal deploys from a generated deployment repo with no flags", async () => {
    const root = tempDir();
    writeDeploymentRepo(root);
    const dispatchDeployWorkflow = vi.fn(async () => ({
      target: "acme/deploy:deploy.yml:dev",
      status: "created" as const,
      message: "dispatched",
    }));

    const result = await runEnterpriseDeploy(
      { component: "all", wait: false },
      {
        stdinIsTty: false,
        cwd: root,
        loadDeployment: vi.fn(() => null),
        inferRepository: vi.fn(() => "acme/deploy"),
        workflowClient: {
          dispatchDeployWorkflow,
          latestDeployRun: vi.fn(async () => ({
            id: "789",
            url: "https://github.com/acme/deploy/actions/runs/789",
            status: "queued",
            failedJobs: [],
          })),
          getRun: vi.fn(),
          listRunArtifacts: vi.fn(),
        },
      },
    );

    expect(result.kind).toBe("dispatch");
    expect(dispatchDeployWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: "acme/deploy",
        stage: "dev",
        component: "all",
      }),
    );
  });

  it("prompts for normal deploy values when run bare in an interactive deployment repo", async () => {
    const root = tempDir();
    writeDeploymentRepo(root);
    const promptInput = vi.fn(async (_message, defaultValue) => {
      return defaultValue ?? "";
    });
    const promptSelect = vi.fn(async (options) => options.defaultValue);
    const promptConfirm = vi.fn(async () => false);

    const request = await resolveEnterpriseDeployRequest(
      { component: "all" },
      {
        stdinIsTty: true,
        cwd: root,
        loadDeployment: vi.fn(() => null),
        inferRepository: vi.fn(() => "acme/deploy"),
        promptInput,
        promptSelect,
        promptConfirm,
      },
    );

    expect(request).toEqual(
      expect.objectContaining({
        customerSlug: "acme",
        repository: "acme/deploy",
        stage: "dev",
        component: "all",
        runSmokes: false,
      }),
    );
    expect(promptInput).toHaveBeenCalledWith("Deployment stage:", "dev");
    expect(promptSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Deployment component:",
        defaultValue: "all",
      }),
    );
    expect(promptConfirm).toHaveBeenCalledWith(
      "Run smoke checks after deploy?",
    );
  });

  it("infers GitHub owner/name from common origin remote formats", () => {
    expect(parseGitHubRepositoryRemote("git@github.com:acme/deploy.git")).toBe(
      "acme/deploy",
    );
    expect(
      parseGitHubRepositoryRemote("https://github.com/acme/deploy.git"),
    ).toBe("acme/deploy");
    expect(
      parseGitHubRepositoryRemote("ssh://git@github.com/acme/deploy.git"),
    ).toBe("acme/deploy");
    expect(
      inferGitHubRepositoryFromRemote("/definitely/not/a/git/repository"),
    ).toBeUndefined();
  });
});

describe("local deploy characterization", () => {
  it("keeps local Terraform component validation on the local path", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    const error = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      runLocalTerraformDeploy({
        stage: "dev",
        component: "smokes",
        yes: true,
      } as DeployCommandOptions),
    ).rejects.toThrow("process.exit");

    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalled();
  });
});
