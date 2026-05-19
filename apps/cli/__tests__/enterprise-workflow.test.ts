import { describe, expect, it, vi } from "vitest";

import {
  runEnterpriseWorkflow,
  WorkflowRunFailedError,
  type EnterpriseWorkflowClient,
} from "../src/commands/enterprise/workflow.js";

function workflowClient(
  overrides: Partial<EnterpriseWorkflowClient> = {},
): EnterpriseWorkflowClient {
  return {
    dispatchDeployWorkflow: vi.fn(async () => ({
      target: "acme/deploy:deploy.yml:dev",
      status: "created",
      message: "dispatched",
    })),
    latestDeployRun: vi.fn(async () => ({
      id: "123",
      url: "https://github.com/acme/deploy/actions/runs/123",
      status: "in_progress",
      failedJobs: [],
    })),
    getRun: vi.fn(async () => ({
      id: "123",
      url: "https://github.com/acme/deploy/actions/runs/123",
      status: "completed",
      conclusion: "success",
      failedJobs: [],
    })),
    listRunArtifacts: vi.fn(async () => ["thinkwork-deploy-dev-123"]),
    ...overrides,
  };
}

describe("enterprise workflow dispatch and watch", () => {
  it("dispatches, waits for success, lists artifacts, and discovers URLs", async () => {
    const client = workflowClient();
    const result = await runEnterpriseWorkflow(
      {
        repository: "acme/deploy",
        stage: "dev",
        component: "all",
        wait: true,
        region: "us-east-1",
      },
      {
        client,
        discoverUrls: vi.fn(() => ({
          apiEndpoint: "https://api.example.test",
          appSyncUrl: "https://appsync.example.test/graphql",
        })),
        sleep: vi.fn(async () => undefined),
      },
    );

    expect(client.dispatchDeployWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: "acme/deploy",
        stage: "dev",
        component: "all",
      }),
    );
    expect(result.waited).toBe(true);
    expect(result.run?.id).toBe("123");
    expect(result.artifacts).toEqual(["thinkwork-deploy-dev-123"]);
    expect(result.urls.apiEndpoint).toBe("https://api.example.test");
  });

  it("supports no-wait dispatch with a run URL and no polling", async () => {
    const client = workflowClient();
    const result = await runEnterpriseWorkflow(
      {
        repository: "acme/deploy",
        stage: "dev",
        component: "overlays",
        runSmokes: false,
        wait: false,
      },
      { client },
    );

    expect(client.dispatchDeployWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ component: "overlays", runSmokes: false }),
    );
    expect(client.getRun).not.toHaveBeenCalled();
    expect(result.waited).toBe(false);
    expect(result.run?.url).toContain("/actions/runs/123");
  });

  it("retries run lookup after dispatch before failing", async () => {
    const client = workflowClient({
      latestDeployRun: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: "123",
          url: "https://github.com/acme/deploy/actions/runs/123",
          status: "in_progress",
          failedJobs: [],
        }),
    });
    const sleep = vi.fn(async () => undefined);

    await runEnterpriseWorkflow(
      {
        repository: "acme/deploy",
        stage: "dev",
        component: "all",
        wait: false,
        runLookupDelayMs: 1,
      },
      { client, sleep },
    );

    expect(client.latestDeployRun).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1);
  });

  it("throws failed job names when the watched run fails", async () => {
    const client = workflowClient({
      getRun: vi.fn(async () => ({
        id: "123",
        url: "https://github.com/acme/deploy/actions/runs/123",
        status: "completed",
        conclusion: "failure",
        failedJobs: ["Deploy dev"],
      })),
    });

    await expect(
      runEnterpriseWorkflow(
        {
          repository: "acme/deploy",
          stage: "dev",
          component: "all",
          wait: true,
        },
        { client, sleep: vi.fn(async () => undefined) },
      ),
    ).rejects.toThrow(WorkflowRunFailedError);
  });

  it("keeps run success when URL discovery fails", async () => {
    const client = workflowClient();
    const result = await runEnterpriseWorkflow(
      {
        repository: "acme/deploy",
        stage: "dev",
        component: "all",
        wait: true,
        region: "us-east-1",
      },
      {
        client,
        discoverUrls: vi.fn(() => {
          throw new Error("aws unavailable");
        }),
        sleep: vi.fn(async () => undefined),
      },
    );

    expect(result.run?.conclusion).toBe("success");
    expect(result.discoveryWarning).toMatch(/aws unavailable/);
  });
});
