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
    plan: {} as EnterpriseBootstrapResult["plan"],
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
        dispatchWorkflow: vi.fn(async () => ({
          target: "acme/deploy:deploy.yml:dev",
          status: "created",
          message: "dispatched",
        })),
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
