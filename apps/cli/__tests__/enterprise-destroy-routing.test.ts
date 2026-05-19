import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runDestroyCommand,
  type DestroyCommandOptions,
} from "../src/commands/destroy.js";
import {
  resolveEnterpriseDestroyRequest,
  runEnterpriseDestroy,
  shouldUseEnterpriseDestroy,
} from "../src/commands/enterprise/destroy.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "thinkwork-enterprise-destroy-"));
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
          dev: { tenantSlug: "acme-dev" },
          prod: { tenantSlug: "acme" },
        },
      },
      null,
      2,
    ),
  );
}

describe("enterprise destroy routing", () => {
  it("routes destroy to enterprise CI inside a generated deployment repo", async () => {
    const root = tempDir();
    writeDeploymentRepo(root);

    expect(shouldUseEnterpriseDestroy({}, { cwd: root })).toBe(true);
  });

  it("keeps local Terraform destroy outside enterprise context", async () => {
    const localDestroy = vi.fn(async () => undefined);
    const enterpriseDestroy = vi.fn();

    await runDestroyCommand(
      { stage: "dev", component: "all", yes: true },
      { localDestroy, enterpriseDestroy },
    );

    expect(localDestroy).toHaveBeenCalledOnce();
    expect(enterpriseDestroy).not.toHaveBeenCalled();
  });

  it("dispatches enterprise destroy from top-level destroy command", async () => {
    const enterpriseDestroy = vi.fn(async () => ({
      request: {
        customerSlug: "acme",
        repository: "acme/deploy",
        stage: "dev",
        wait: true,
      },
      workflow: {
        dispatch: {
          target: "acme/deploy:deploy.yml:dev",
          status: "created" as const,
          message: "dispatched",
        },
        run: {
          id: "123",
          url: "https://github.com/acme/deploy/actions/runs/123",
          status: "completed",
          conclusion: "success",
          failedJobs: [],
        },
        artifacts: ["thinkwork-destroy-dev-123"],
        urls: {},
        waited: true,
      },
    }));

    await runDestroyCommand(
      {
        customer: "acme",
        repo: "acme/deploy",
        stage: "dev",
        component: "all",
        yes: true,
      },
      { localDestroy: vi.fn(), enterpriseDestroy },
    );

    expect(enterpriseDestroy).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "acme",
        repo: "acme/deploy",
        stage: "dev",
      }),
    );
  });

  it("prompts for stage when bare thinkwork destroy runs in a deployment repo", async () => {
    const root = tempDir();
    writeDeploymentRepo(root);

    const request = await resolveEnterpriseDestroyRequest(
      {},
      {
        cwd: root,
        stdinIsTty: true,
        loadDeployment: vi.fn(() => null),
        inferRepository: vi.fn(() => "acme/deploy"),
        promptInput: vi.fn(
          async (_message, defaultValue) => defaultValue ?? "",
        ),
      },
    );

    expect(request).toEqual(
      expect.objectContaining({
        customerSlug: "acme",
        repository: "acme/deploy",
        stage: "dev",
        wait: true,
      }),
    );
  });

  it("requires --yes for non-interactive enterprise destroy", async () => {
    await expect(
      runEnterpriseDestroy(
        {
          customer: "acme",
          repo: "acme/deploy",
          stage: "dev",
        },
        { stdinIsTty: false },
      ),
    ).rejects.toThrow(/without --yes/);
  });

  it("uses a stern confirmation message before enterprise destroy", async () => {
    const promptConfirm = vi.fn(async () => true);
    const dispatchDeployWorkflow = vi.fn(async () => ({
      target: "acme/deploy:deploy.yml:dev",
      status: "created" as const,
      message: "dispatched",
    }));

    await runEnterpriseDestroy(
      {
        customer: "acme",
        repo: "acme/deploy",
        stage: "dev",
        wait: false,
      },
      {
        stdinIsTty: true,
        promptConfirm,
        workflowClient: {
          dispatchDeployWorkflow,
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

    expect(promptConfirm).toHaveBeenCalledWith(
      expect.stringContaining("permanently remove the \"dev\" stage stack"),
    );
    expect(promptConfirm).toHaveBeenCalledWith(
      expect.stringContaining("Customer-wide bootstrap resources"),
    );
  });

  it("dispatches operation=destroy with smokes disabled", async () => {
    const dispatchDeployWorkflow = vi.fn(async () => ({
      target: "acme/deploy:deploy.yml:dev",
      status: "created" as const,
      message: "dispatched",
    }));

    const result = await runEnterpriseDestroy(
      {
        customer: "acme",
        repo: "acme/deploy",
        stage: "dev",
        yes: true,
        wait: false,
      },
      {
        stdinIsTty: false,
        workflowClient: {
          dispatchDeployWorkflow,
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

    expect(result.workflow.waited).toBe(false);
    expect(dispatchDeployWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "destroy",
        repository: "acme/deploy",
        stage: "dev",
        component: "all",
        runSmokes: false,
      }),
    );
  });

  it("lets --local-terraform force the local destroy path", () => {
    expect(
      shouldUseEnterpriseDestroy({
        localTerraform: true,
        customer: "acme",
      } as DestroyCommandOptions),
    ).toBe(false);
  });
});
